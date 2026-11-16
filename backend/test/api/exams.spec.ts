/** Real SQL and HTTP/auth; the retrieval/model boundary is the fake AI service. */
import { createHash } from "node:crypto";
import { Harness } from "../support/harness";

const h = new Harness();
const TEXT = "Evaporation changes liquid water to vapour.";
const EXAM = [
  "1. Which process changes liquid water to vapour?",
  "A) Freezing",
  "B) Evaporation",
  "C) Melting",
  "2. Explain evaporation. Açıklayınız.",
  "3. Is evaporation a cooling process? Doğru veya yanlış yazınız.",
  "4. Calculate the heat needed to evaporate 2 kg of water. Hesaplayınız.",
].join("\n");

beforeAll(async () => {
  await h.start();
});
afterAll(async () => {
  await h.stop();
});

beforeEach(async () => {
  await h.reset();
  await h.prisma.studyMaterial.create({
    data: {
      id: "water-notes", courseId: h.world.courses.vy, ownerId: h.world.users.ayse, kind: "TXT",
      title: "Physics notes", filename: "physics.txt", sha256: "a".repeat(64),
      segments: [{ text: TEXT, location: { kind: "text", section: 1 } }],
    },
  });
  h.ai.on("POST", "/api/v1/knowledge/state", () => ({ status: 200, body: { versions: {} } }));
  h.ai.on("POST", "/api/v1/knowledge/index", () => ({ status: 200, body: { indexed: 1 } }));
  h.ai.on("POST", "/api/v1/knowledge/search", (r) => {
    // A topic named "Nothing" has no supporting source in the course.
    if (String(r.body.question).includes("Nothing")) return { status: 200, body: { evidence: [], associations: [], conflicts: [] } };
    const m = r.body.materials[0];
    const location = { kind: "text", section: 1 };
    const id = createHash("sha256").update(m.id + m.version + JSON.stringify(location) + TEXT).digest("hex");
    return { status: 200, body: { evidence: [{ id, text: TEXT, location, material_id: m.id, version: m.version, kind: m.kind }], associations: [], conflicts: [] } };
  });
  h.ai.on("POST", "/api/v1/knowledge/quiz", (r) => {
    const kind = r.body.kind as string;
    const options = kind === "MULTIPLE_CHOICE" ? ["Freezing", "Evaporation", "Melting", "Boiling"] : kind === "TRUE_FALSE" ? ["Doğru", "Yanlış"] : [];
    return {
      status: 200,
      body: {
        kind, question: `Question about ${r.body.question} (${kind})`, options,
        expected: kind === "MULTIPLE_CHOICE" ? "1" : kind === "TRUE_FALSE" ? "0" : kind === "OPEN" ? "" : "Evaporation",
        explanation: "The source says evaporation changes liquid water to vapour.",
        quote: r.body.evidence[0].text, source_index: 1,
        quality: { structural_validation: true, independent_model_review: true, option_audit_version: 2 },
      },
    };
  });
});

const course = () => `/courses/${h.world.courses.vy}`;

async function saveStyle(who: "ayse" | "mehmet" = "ayse") {
  const res = await h.http().post(`${course()}/exam-styles`).set(await h.as(who)).send({ name: "Final 2025", text: EXAM }).expect(201);
  return res.body.id as string;
}

async function waitDone(id: string, who: "ayse" | "mehmet" = "ayse") {
  for (let i = 0; i < 60; i++) {
    const res = await h.http().get(`${course()}/exams/${id}`).set(await h.as(who)).expect(200);
    if (res.body.status !== "GENERATING") return res.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("exam did not finish");
}

test("a past exam file becomes a saved style, and unsupported files are refused", async () => {
  h.ai.on("POST", "/api/v1/knowledge/exam-text", () => ({ status: 200, body: { text: EXAM } }));
  const ok = await h.http().post(`${course()}/exam-styles/file`).set(await h.as("ayse"))
    .attach("file", Buffer.from("%PDF-1.4 fake"), "Final 2025.pdf").expect(201);
  expect(ok.body.name).toBe("Final 2025");
  expect(ok.body.profile.question_count).toBe(4);
  expect(h.ai.calls("POST", "/api/v1/knowledge/exam-text")[0].body.kind).toBe("PDF");

  await h.http().post(`${course()}/exam-styles/file`).set(await h.as("ayse"))
    .attach("file", Buffer.from("MZ binary"), "virus.exe").expect(415);
  await h.http().post(`${course()}/exam-styles/file`).set(await h.as("ayse"))
    .attach("file", Buffer.from("not really a pdf"), "fake.pdf").expect(415);
});

test("an unreadable file (scanned pdf) is a clear validation error and nothing is stored", async () => {
  h.ai.on("POST", "/api/v1/knowledge/exam-text", () => ({ status: 422, body: { detail: "x" } }));
  const before = await h.prisma.examStyle.count();
  const res = await h.http().post(`${course()}/exam-styles/file`).set(await h.as("ayse"))
    .attach("file", Buffer.from("%PDF-1.4 scanned"), "scan.pdf").expect(422);
  expect(res.body.error.code).toBe("VALIDATION_ERROR");
  expect(await h.prisma.examStyle.count()).toBe(before);
});

test("a new exam follows the style's mix, is source-bound, hides answers and prints a key", async () => {
  const style = await saveStyle();
  const created = await h.http().post(`${course()}/exams`).set(await h.as("ayse"))
    .send({ exam_style_id: style, count: 4, topics: ["Evaporation"] }).expect(202);
  expect(created.body).toMatchObject({ status: "GENERATING", requested: 4 });

  const exam = await waitDone(created.body.id);
  expect(exam.status).toBe("READY");
  expect(exam.questions).toHaveLength(4);
  expect(exam.questions.map((q: any) => q.kind).sort()).toEqual(["MULTIPLE_CHOICE", "OPEN", "SHORT_ANSWER", "TRUE_FALSE"]);
  for (const q of exam.questions) {
    expect(q.available).toBe(true);
    expect(q.expected).toBeUndefined();
    expect(q.quote).toBeUndefined();
    expect(q.source.text).toBeUndefined();
    expect(q.source.title).toBe("Physics notes");
  }
  // every question reached the model with the exam style hint and a real source
  const calls = h.ai.calls("POST", "/api/v1/knowledge/quiz");
  expect(calls).toHaveLength(4);
  for (const c of calls) {
    expect(c.body.style_hint).toContain("Sınav stili");
    expect(c.body.evidence[0].text).toBe(TEXT);
  }

  const key = await h.http().get(`${course()}/exams/${created.body.id}/key`).set(await h.as("ayse")).expect(200);
  const mc = key.body.key.find((k: any) => k.kind === "MULTIPLE_CHOICE");
  expect(mc.expected).toBe("Evaporation");
  expect(key.body.key.find((k: any) => k.kind === "OPEN").expected).toBeNull();

  // the generated questions are ordinary quiz questions: they can be answered and show in history
  const answer = await h.http().post(`${course()}/quizzes/${exam.questions[0].id}/answers`).set(await h.as("ayse"))
    .send({ response: exam.questions[0].options?.length ? "1" : "Evaporation" });
  expect([200, 201]).toContain(answer.status);
  const list = await h.http().get(`${course()}/exams`).set(await h.as("ayse")).expect(200);
  expect(list.body[0]).toMatchObject({ id: created.body.id, status: "READY", produced: 4 });
});

test("a topic with no supporting source is reported, never invented", async () => {
  const style = await saveStyle();
  const created = await h.http().post(`${course()}/exams`).set(await h.as("ayse"))
    .send({ exam_style_id: style, count: 2, topics: ["Nothing", "Evaporation"] }).expect(202);
  const exam = await waitDone(created.body.id);
  expect(exam.status).toBe("READY");
  expect(exam.failures.length).toBeGreaterThan(0);
  expect(exam.failures[0].topic).toBe("Nothing");

  const only = await h.http().post(`${course()}/exams`).set(await h.as("ayse"))
    .send({ exam_style_id: style, count: 2, topics: ["Nothing"] }).expect(202);
  const failed = await waitDone(only.body.id);
  expect(failed.status).toBe("FAILED");
  expect(failed.questions).toEqual([]);
  expect(failed.note).toContain("kaynak");
});

test("an exam and its style belong to their owner", async () => {
  const style = await saveStyle();
  const created = await h.http().post(`${course()}/exams`).set(await h.as("ayse"))
    .send({ exam_style_id: style, count: 1, topics: ["Evaporation"] }).expect(202);
  await waitDone(created.body.id);
  await h.http().get(`${course()}/exams/${created.body.id}`).set(await h.as("mehmet")).expect(404);
  await h.http().get(`${course()}/exams/${created.body.id}/key`).set(await h.as("mehmet")).expect(404);
  await h.http().post(`${course()}/exams`).set(await h.as("mehmet")).send({ exam_style_id: style, count: 1, topics: ["x"] }).expect(404);
  await h.http().delete(`${course()}/exams/${created.body.id}`).set(await h.as("mehmet")).expect(404);
  await h.http().delete(`${course()}/exams/${created.body.id}`).set(await h.as("ayse")).expect(200);
  await h.http().get(`${course()}/exams/${created.body.id}`).set(await h.as("ayse")).expect(404);
});

test("validation: count and topics are bounded, and only one exam runs at a time", async () => {
  const style = await saveStyle();
  await h.http().post(`${course()}/exams`).set(await h.as("ayse")).send({ exam_style_id: style, count: 0 }).expect(422);
  await h.http().post(`${course()}/exams`).set(await h.as("ayse")).send({ exam_style_id: style, count: 21 }).expect(422);
  await h.http().post(`${course()}/exams`).set(await h.as("ayse")).send({ exam_style_id: "not-a-uuid", count: 2 }).expect(422);
  await h.prisma.generatedExam.create({ data: { id: "00000000-0000-4000-8000-000000000001", courseId: h.world.courses.vy, userId: h.world.users.ayse, title: "busy", status: "GENERATING", requested: 1, topics: [], items: [], failures: [] } });
  const res = await h.http().post(`${course()}/exams`).set(await h.as("ayse")).send({ exam_style_id: style, count: 1, topics: ["Evaporation"] }).expect(409);
  expect(res.body.error.code).toBe("JOB_ALREADY_RUNNING");
});

test("deleting a personal course removes its saved styles and generated exams", async () => {
  const mine = await h.http().post("/courses").set(await h.as("ayse"))
    .send({ name: "My own course", description: "Private study", category: "Physics" }).expect(201);
  const style = await h.http().post(`/courses/${mine.body.id}/exam-styles`).set(await h.as("ayse"))
    .send({ name: "Old exam", text: EXAM }).expect(201);
  await h.prisma.generatedExam.create({ data: { id: "00000000-0000-4000-8000-000000000002", courseId: mine.body.id, userId: h.world.users.ayse, styleId: style.body.id, title: "t", status: "READY", requested: 1, topics: [], items: [], failures: [] } });
  const other = await saveStyle(); // a style of another course must survive
  await h.http().delete("/courses/" + mine.body.id).set(await h.as("ayse")).send({ confirm_name: "My own course" }).expect(200);
  expect(await h.prisma.generatedExam.count({ where: { courseId: mine.body.id } })).toBe(0);
  expect(await h.prisma.examStyle.count({ where: { courseId: mine.body.id } })).toBe(0);
  expect(await h.prisma.examStyle.count({ where: { id: other } })).toBe(1);
});
