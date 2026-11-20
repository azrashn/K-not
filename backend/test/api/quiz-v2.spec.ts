/** QUIZ_ENGINE=v2 through real SQL and HTTP; the ai-service is the fake. The public API keeps its shape. */
import { createHash } from "node:crypto";
import { Harness } from "../support/harness";

const h = new Harness();
const TEXT = "Evaporation changes liquid water to vapour.";
const QUALITY = { pipeline_version: "single-call-v1", deterministic_validation: true, structural_validation: true,
  independent_model_review: false, truth_verified: false, attempts: 1, feedback_mode: "SOURCE_EXPLANATION" };

beforeAll(async () => {
  await h.start({ quizEngine: "v2" });
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
    const m = r.body.materials[0];
    const location = { kind: "text", section: 1 };
    const id = createHash("sha256").update(m.id + m.version + JSON.stringify(location) + TEXT).digest("hex");
    return { status: 200, body: { evidence: [{ id, text: TEXT, location, material_id: m.id, version: m.version, kind: m.kind }], associations: [], conflicts: [] } };
  });
});

const base = () => `/courses/${h.world.courses.vy}/quizzes`;

test("a v2 exam is written from several past exams and remembers all of them", async () => {
  const course = `/courses/${h.world.courses.vy}`;
  const as = await h.as("ayse");
  const final = await h.http().post(`${course}/exam-styles`).set(as).send({
    name: "Final", text: ["1. Which process changes water to vapour?", "A) Freezing", "B) Evaporation", "C) Melting",
      "2. Explain evaporation. Açıklayınız."].join("\n"),
  }).expect(201);
  const midterm = await h.http().post(`${course}/exam-styles`).set(as).send({
    name: "Vize", text: ["1. Is evaporation a cooling process? Doğru veya yanlış yazınız.",
      "2. Calculate the heat for 2 kg of water. Hesaplayınız.", "3. Explain boiling. Açıklayınız.", "4. Explain melting. Açıklayınız."].join("\n"),
  }).expect(201);
  // Enough text for 3 questions: each source part carries one (generation/source-pool capacity).
  await h.prisma.studyMaterial.create({
    data: {
      id: "water-more", courseId: h.world.courses.vy, ownerId: h.world.users.ayse, kind: "TXT",
      title: "More physics notes", filename: "more.txt", sha256: "b".repeat(64),
      segments: [
        { text: "Evaporation cools the surface that loses the water.", location: { kind: "text", section: 1 } },
        { text: "Evaporation happens below the boiling point of water.", location: { kind: "text", section: 2 } },
      ],
    },
  });
  // The model is down: the run stops after its first request, which is enough to see what was asked.
  h.ai.on("POST", "/api/v1/knowledge/quiz", () => ({ status: 503, body: {} }));

  const created = await h.http().post(`${course}/exams`).set(as)
    .send({ exam_style_ids: [final.body.id, midterm.body.id], topics: ["Evaporation"] }).expect(202);
  expect(created.body).toMatchObject({
    title: "2 geçmiş sınavdan yeni sınav",
    requested: 3, // average of 2 and 4 questions
    style_id: final.body.id,
    style_ids: [final.body.id, midterm.body.id],
  });
  let exam: any;
  for (let i = 0; i < 60; i++) {
    exam = (await h.http().get(`${course}/exams/${created.body.id}`).set(as).expect(200)).body;
    if (exam.status !== "GENERATING") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(exam.status).toBe("FAILED");
  expect(exam.style_ids).toEqual([final.body.id, midterm.body.id]);
  expect(exam.note).toContain("modele ulaşılamadığı");
  const sent = h.ai.calls("POST", "/api/v1/knowledge/quiz")[0].body;
  expect(sent.evidence).toHaveLength(1); // one chosen source part per request, no search
  const hint = sent.style_hint as string;
  expect(hint).toContain("2 geçmiş sınav, toplam 6 soru;");
  expect(hint).toContain("Which process changes water to vapour?");
  expect(hint).toContain("Is evaporation a cooling process?");
});
const v2Question = (slot: number, kind: string) => ({
  slot, kind, question: "Which process changes liquid water to vapour?",
  options: kind === "MULTIPLE_CHOICE" ? ["Freezing", "Evaporation", "Melting", "Boiling"] : [],
  expected: kind === "MULTIPLE_CHOICE" ? "1" : kind === "OPEN" ? "" : "Evaporation",
  quote: TEXT, source_index: 1, explanation: "The source says evaporation changes water to vapour.",
  objective: null, option_feedback: [], experimental: true, llm_used: true, question_style: "CONCEPTUAL",
  assessment: "SOURCE_CHECKED_UNVERIFIED", quality: QUALITY, note: "Soru kodla denetlendi.",
});

test("a quiz of 3 questions is a set: 202 at once, then GET /quiz-sets/:id; exams never list it", async () => {
  const course = `/courses/${h.world.courses.vy}`;
  const as = await h.as("ayse");
  await h.prisma.studyMaterial.create({
    data: {
      id: "water-set", courseId: h.world.courses.vy, ownerId: h.world.users.ayse, kind: "TXT",
      title: "Set notes", filename: "set.txt", sha256: "c".repeat(64),
      segments: [
        { text: "Evaporation cools the surface that loses the water.", location: { kind: "text", section: 1 } },
        { text: "Evaporation happens below the boiling point of water.", location: { kind: "text", section: 2 } },
      ],
    },
  });
  // Each request carries one source part; the question rests on it.
  h.ai.on("POST", "/api/v1/knowledge/quiz", (r) => ({
    status: 200, body: { engine: "v2", failures: [], timing: {}, questions: r.body.items.map((it: any, slot: number) => ({
      ...v2Question(slot, it.kind), question: `What does the source say: ${r.body.evidence[0].text}`, quote: r.body.evidence[0].text,
    })) },
  }));
  const started = await h.http().post(base()).set(as).send({ topic: "Evaporation", kind: "OPEN", count: 3 }).expect(202);
  expect(started.body).toMatchObject({ type: "quiz_set", topic: "Evaporation", status: "GENERATING", requested: 3 });
  let set: any;
  for (let i = 0; i < 60; i++) {
    set = (await h.http().get(`${course}/quiz-sets/${started.body.id}`).set(as).expect(200)).body;
    if (set.status !== "GENERATING") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(set).toMatchObject({ status: "READY", produced: 3 });
  expect(set.questions).toHaveLength(3);
  for (const q of set.questions) {
    expect(q.available).toBe(true);
    expect(q.quote).toBeUndefined();
  }
  const calls = h.ai.calls("POST", "/api/v1/knowledge/quiz");
  expect(calls.every((c) => c.body.evidence.length === 1)).toBe(true);
  expect(new Set(calls.map((c) => c.body.evidence[0].text)).size).toBe(3); // three different parts
  await h.http().get(`${course}/exams/${started.body.id}`).set(as).expect(404);
  expect((await h.http().get(`${course}/exams`).set(as).expect(200)).body).toEqual([]);
  await h.http().get(`${course}/quiz-sets/${started.body.id}`).set(await h.as("mehmet")).expect(404);
  await h.http().post(base()).set(as).send({ topic: "Evaporation", kind: "OPEN", count: 16 }).expect(422);
});

test("a v2 question is created, answered and graded through the unchanged public API", async () => {
  h.ai.on("POST", "/api/v1/knowledge/quiz", (r) => ({
    status: 200, body: { engine: "v2", questions: [v2Question(0, r.body.items[0].kind)], failures: [], timing: {} },
  }));
  const q = await h.http().post(base()).set(await h.as("ayse")).send({ topic: "Evaporation", kind: "MULTIPLE_CHOICE" }).expect(201);
  const sent = h.ai.calls("POST", "/api/v1/knowledge/quiz")[0].body;
  expect(sent).toMatchObject({ topic: "Evaporation", items: [{ kind: "MULTIPLE_CHOICE" }], budget_seconds: 130 });
  expect(q.body).toMatchObject({ kind: "MULTIPLE_CHOICE", options: ["Freezing", "Evaporation", "Melting", "Boiling"],
    quality_state: "SOURCE_CHECKED", objective: null });
  expect(q.body.expected).toBeUndefined();
  expect(q.body.quote).toBeUndefined();
  expect(q.body.slot).toBeUndefined();
  const wrong = await h.http().post(`${base()}/${q.body.id}/answers`).set(await h.as("ayse")).send({ response: "0" }).expect(200);
  expect(wrong.body).toMatchObject({ score: 0, expected: "Evaporation", quote: TEXT, selected_option_feedback: null });
  expect(wrong.body.explanation).toContain("evaporation");
  const right = await h.http().post(`${base()}/${q.body.id}/answers`).set(await h.as("ayse")).send({ response: "1" }).expect(200);
  expect(right.body.score).toBe(1);
  const again = await h.http().get(`${base()}/${q.body.id}`).set(await h.as("ayse")).expect(200);
  expect(again.body.quality_state).toBe("SOURCE_CHECKED");
});

test("a rejected v2 question answers with the reason and publishes nothing", async () => {
  h.ai.on("POST", "/api/v1/knowledge/quiz", () => ({
    status: 200, body: { engine: "v2", questions: [], timing: {},
      failures: [{ slot: 0, kind: "MULTIPLE_CHOICE", code: "QUOTE_NOT_FOUND", detail: "x", attempts: 2, seconds: 50 }] },
  }));
  const before = await h.prisma.learningQuiz.count();
  const r = await h.http().post(base()).set(await h.as("ayse")).send({ topic: "Evaporation", kind: "MULTIPLE_CHOICE" }).expect(502);
  expect(r.body.error.code).toBe("GENERATION_FAILED");
  expect(r.body.error.message).toContain("alıntı kaynakta birebir bulunamadı (2 deneme)");
  expect(r.body.error.details.reasons).toEqual([{ code: "QUOTE_NOT_FOUND", kind: "MULTIPLE_CHOICE", attempts: 2 }]);
  expect(await h.prisma.learningQuiz.count()).toBe(before);
});

test("a question that fails the backend recheck is not stored", async () => {
  h.ai.on("POST", "/api/v1/knowledge/quiz", () => ({
    status: 200, body: { engine: "v2", questions: [{ ...v2Question(0, "MULTIPLE_CHOICE"), quote: "Water always boils." }], failures: [] },
  }));
  const r = await h.http().post(base()).set(await h.as("ayse")).send({ topic: "Evaporation", kind: "MULTIPLE_CHOICE" }).expect(502);
  expect(r.body.error.details.reasons[0].code).toBe("INVALID_SHAPE");
  expect(await h.prisma.learningQuiz.count()).toBe(0);
});

test("model timeout and an ai-service with v2 switched off are reported plainly", async () => {
  h.ai.on("POST", "/api/v1/knowledge/quiz", () => ({
    status: 200, body: { engine: "v2", questions: [], failures: [{ slot: 0, code: "TIMEOUT", attempts: 1 }] },
  }));
  const t = await h.http().post(base()).set(await h.as("ayse")).send({ topic: "Evaporation", kind: "OPEN" }).expect(504);
  expect(t.body.error.message).toContain("zaman aşımı");
  h.ai.on("POST", "/api/v1/knowledge/quiz", () => ({ status: 409, body: { detail: { code: "QUIZ_ENGINE_DISABLED" } } }));
  const d = await h.http().post(base()).set(await h.as("ayse")).send({ topic: "Evaporation", kind: "OPEN" }).expect(503);
  expect(d.body.error.message).toContain("QUIZ_ENGINE=legacy");
});
