/** Real SQL and HTTP/auth; the video engine and the AI service are the fake boundaries. */
import { Harness } from "../support/harness";
import { FakeAiService } from "../support/fake-ai";

const h = new Harness();
const engine = new FakeAiService();
const ENGINE_ID = "up_0123abcdef";
let chunks: { text: string; t_start: number; t_end: number }[] = [];

beforeAll(async () => {
  await engine.start();
  await h.start({ videoServiceUrl: engine.url });
});
afterAll(async () => {
  await h.stop();
  await engine.stop();
});

beforeEach(async () => {
  await h.reset();
  chunks = [
    { text: "bfs bir kuyruk kullanir", t_start: 0, t_end: 5 },
    { text: "dfs bir yigin kullanir", t_start: 5, t_end: 10 },
    { text: "dijkstra negatif agirlik", t_start: 10, t_end: 15 },
  ];
  await h.prisma.video.create({
    data: { id: "lecture", ownerId: h.world.users.ayse, courseId: h.world.courses.vy, engineVideoId: ENGINE_ID, title: "Lesson", originalFilename: "a.mp4", contentSha256: "d".repeat(64), durationMs: 20000 },
  });
  engine.on("GET", "/api/videos/" + ENGINE_ID, () => ({ status: 200, body: { id: ENGINE_ID, status: "indexed" } }));
  engine.on("GET", "/api/transcript/" + ENGINE_ID, () => ({ status: 200, body: { video_id: ENGINE_ID, chunks } }));
  h.ai.on("POST", "/api/v1/knowledge/state", () => ({ status: 200, body: { versions: {} } }));
  h.ai.on("POST", "/api/v1/knowledge/index", () => ({ status: 200, body: { indexed: 1 } }));
  h.ai.on("POST", "/api/v1/knowledge/search", () => ({ status: 200, body: { evidence: [], associations: [], conflicts: [] } }));
});

const base = () => `/courses/${h.world.courses.vy}/videos/lecture/transcript`;
type Who = "ayse" | "mehmet";
const read = async (status = 200, who: Who = "ayse") => h.http().get(base()).set(await h.as(who)).expect(status);
const put = async (index: number, text: unknown, status = 200, who: Who = "ayse") =>
  h.http().put(`${base()}/${index}`).set(await h.as(who)).send({ text }).expect(status);

test("a fix is laid over the transcript, the original stays visible, other chunks are untouched", async () => {
  const saved = await put(0, "BFS bir kuyruk kullanır");
  expect(saved.body).toMatchObject({ index: 0, corrected: true, text: "BFS bir kuyruk kullanır", original_text: "bfs bir kuyruk kullanir" });
  const t = (await read()).body;
  expect(t.chunks[0]).toMatchObject({ index: 0, text: "BFS bir kuyruk kullanır", corrected: true, original_text: "bfs bir kuyruk kullanir", start_seconds: 0, end_seconds: 5 });
  expect(t.chunks[1]).toMatchObject({ text: "dfs bir yigin kullanir", corrected: false });
  expect(t.stale_corrections).toEqual([]);
});

test("editing again keeps the previous text in the history, and the same text as the engine removes the fix", async () => {
  await put(1, "DFS bir yığın kullanır");
  await put(1, "DFS bir yığın kullanır ve dallanır");
  const row = await h.prisma.transcriptCorrection.findFirstOrThrow({ where: { videoId: "lecture", chunkIndex: 1 } });
  expect((row.history as any[]).map((e) => e.text)).toEqual(["DFS bir yığın kullanır", "dfs bir yigin kullanir"]);
  expect((await put(1, "  dfs   bir yigin kullanir ")).body.corrected).toBe(false);
  expect(await h.prisma.transcriptCorrection.count()).toBe(0);
});

test("a fix can be undone", async () => {
  await put(2, "Dijkstra negatif ağırlık");
  await h.http().delete(`${base()}/2`).set(await h.as("ayse")).expect(200).expect((r) => expect(r.body).toMatchObject({ corrected: false, text: "dijkstra negatif agirlik" }));
  expect((await read()).body.chunks[2].corrected).toBe(false);
});

test("only the owner can read or change the transcript", async () => {
  await put(0, "x yy zz", 404, "mehmet");
  await read(404, "mehmet");
  await h.http().delete(`${base()}/0`).set(await h.as("mehmet")).expect(404);
  await h.http().put(`${base()}/0`).send({ text: "abc" }).expect(401);
});

test("bad input is refused: empty, too long, no such chunk", async () => {
  await put(0, "   ", 422);
  await put(0, "a".repeat(3001), 422);
  await put(0, 123, 422);
  await put(9, "geçerli bir metin", 404);
  expect(await h.prisma.transcriptCorrection.count()).toBe(0);
});

test("after the engine text changed, the old fix is reported as stale and not applied to other words", async () => {
  await put(0, "BFS bir kuyruk kullanır");
  chunks[0] = { ...chunks[0], text: "bfs bir kuyruk kullanir ve seviye gezer" };
  const t = (await read()).body;
  expect(t.chunks[0]).toMatchObject({ text: "bfs bir kuyruk kullanir ve seviye gezer", corrected: false });
  expect(t.stale_corrections).toEqual([0]);
});

test("a fix changes the material version, and the index receives the corrected words", async () => {
  const materials = async () => (await h.http().get(`/courses/${h.world.courses.vy}/knowledge/materials`).set(await h.as("ayse")).expect(200)).body.materials;
  const before = (await materials()).find((m: any) => m.id === "video_lecture");
  await put(0, "BFS bir kuyruk kullanır");
  const after = (await materials()).find((m: any) => m.id === "video_lecture");
  expect(after.version).not.toBe(before.version);

  await h.http().post(`/courses/${h.world.courses.vy}/knowledge/search`).set(await h.as("ayse")).send({ question: "BFS nedir?" });
  const indexed = h.ai.calls("POST", "/api/v1/knowledge/index").flatMap((c) => c.body.segments ?? []).map((s: any) => s.text);
  expect(indexed.some((t: string) => t.includes("BFS bir kuyruk kullanır"))).toBe(true);
  expect(indexed.some((t: string) => t === "bfs bir kuyruk kullanir")).toBe(false);
});

test("a fix goes away with its video", async () => {
  await put(0, "BFS bir kuyruk kullanır");
  await h.prisma.video.delete({ where: { id: "lecture" } });
  expect(await h.prisma.transcriptCorrection.count()).toBe(0);
});
