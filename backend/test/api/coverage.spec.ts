import { Harness } from "../support/harness";
const h = new Harness();
beforeAll(async () => { await h.start(); });
afterAll(async () => { await h.stop(); });
beforeEach(async () => { await h.reset(); });

const evidence = (material_id: string, page: number) => ({
  material_id, kind: "PDF", id: "a".repeat(64), version: "v", text: "x", location: { kind: "page", page },
});
async function say(conv: string, material_id: string, pages: number[], redacted = false) {
  await h.prisma.learningMessage.create({
    data: {
      conversationId: conv, role: "assistant", content: "yanıt", redacted,
      payload: { evidence: redacted ? [] : pages.map((p) => evidence(material_id, p)) },
    },
  });
}
async function conversation(id: string, userId: string, courseId: string) {
  await h.prisma.learningConversation.create({ data: { id, userId, courseId, title: "t" } });
}
async function quiz(id: string, userId: string, courseId: string, material_id: string, page: number, purpose = "PRACTICE") {
  await h.prisma.learningQuiz.create({
    data: {
      id, userId, courseId, topic: "t", kind: "MULTIPLE_CHOICE", materialId: material_id, segmentId: "s".repeat(64),
      version: "v", purpose, data: { source: { location: { kind: "page", page } } },
    },
  });
}

test("sohbet ve alıştırma kayıtlarından doğru sayım; başka kullanıcı/ders karışmaz", async () => {
  const pdf = await h.uploadOk("ayse", h.world.courses.vy, { name: "a.pdf" });
  await h.makeReady(pdf.id, ["bir", "iki", "üç", "dört", "beş"]);
  const mid = "pdf_" + pdf.id;
  await conversation("c1", h.world.users.ayse, h.world.courses.vy);
  await conversation("c2", h.world.users.mehmet, h.world.courses.vy);
  await say("c1", mid, [2, 3]);
  await say("c1", mid, [3], true); // kaynağı kaldırılmış yanıt sayılmaz
  await say("c2", mid, [1, 4]); // başka kullanıcının sohbeti
  await quiz("q1", h.world.users.ayse, h.world.courses.vy, mid, 5);
  await quiz("q2", h.world.users.ayse, h.world.courses.vy, mid, 4, "EXAM"); // sınav sorusu sayılmaz
  await quiz("q3", h.world.users.mehmet, h.world.courses.vy, mid, 1);
  const r = await h.http().get(`/courses/${h.world.courses.vy}/coverage`).set(await h.as("ayse"));
  expect(r.status).toBe(200);
  const m = r.body.materials.find((x: any) => x.material_id === mid);
  expect(m.page_count).toBe(5);
  expect(m.untouched_pages).toEqual([1, 4]);
  expect(m.pages.filter((p: any) => p.asked).map((p: any) => p.page)).toEqual([2, 3]);
  expect(m.pages.filter((p: any) => p.practiced).map((p: any) => p.page)).toEqual([5]);
  expect(r.body.recorded.studied).toBe(false);
});

test("üye olmayan kullanıcı için ders 404", async () => {
  const r = await h.http().get(`/courses/${h.world.courses.vy}/coverage`).set(await h.as("outsider"));
  expect(r.status).toBe(404);
  const o = await h.http().get(`/courses/${h.world.courses.os}/coverage`).set(await h.as("ayse"));
  expect(o.status).toBe(404);
});

test("kimliksiz istek reddedilir", async () => {
  const r = await h.http().get(`/courses/${h.world.courses.vy}/coverage`);
  expect(r.status).toBe(401);
});
