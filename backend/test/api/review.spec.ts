import { Harness } from "../support/harness";
const h = new Harness();
beforeAll(async () => { await h.start(); });
afterAll(async () => { await h.stop(); });
beforeEach(async () => { await h.reset(); });

const src = (mid: string, page: number) => ({ id: "s".repeat(64), material_id: mid, title: "a.pdf", kind: "PDF", location: { kind: "page", page } });
async function wrongAnswer(quizId: string, userId: string, courseId: string, mid: string, page: number, outcome = "REVIEW_SOURCE", extra: any = {}) {
  await h.prisma.learningQuiz.upsert({
    where: { id: quizId },
    update: {},
    create: {
      id: quizId, userId, courseId, topic: "t", kind: "MULTIPLE_CHOICE", materialId: mid, segmentId: "s".repeat(64), version: "v",
      data: { question: "Soru?", options: ["a", "b"], expected: 1, source: src(mid, page) }, ...extra,
    },
  });
  await h.prisma.learningQuizAttempt.create({ data: { quizId, userId, response: "0", outcome, feedback: {}, score: outcome === "CORRECT" ? 1 : 0 } });
}

test("yanlış kaydı oluşur, tekrar yanlışta güncellenir, doğruda LAST_CORRECT olur", async () => {
  const pdf = await h.uploadOk("ayse", h.world.courses.vy, { name: "a.pdf" });
  await h.makeReady(pdf.id, ["bir", "iki", "üç", "dört"]);
  const mid = "pdf_" + pdf.id;
  const u = h.world.users.ayse, c = h.world.courses.vy;
  await wrongAnswer("q1", u, c, mid, 3);
  await wrongAnswer("q1", u, c, mid, 3);
  await wrongAnswer("q2", u, c, mid, 2, "CORRECT"); // hiç yanlış yapılmadı: deftere girmez
  let r = await h.http().get(`/courses/${c}/review`).set(await h.as("ayse"));
  expect(r.status).toBe(200);
  expect(r.body.counts).toEqual({ open: 1, last_correct: 0 });
  expect(r.body.groups[0].items).toHaveLength(1);
  expect(r.body.groups[0].items[0].wrong_count).toBe(2);
  expect(r.body.groups[0].locator).toEqual({ type: "page", page: 3 });
  await wrongAnswer("q1", u, c, mid, 3, "CORRECT");
  r = await h.http().get(`/courses/${c}/review`).set(await h.as("ayse"));
  expect(r.body.counts).toEqual({ open: 0, last_correct: 1 });
  expect(r.body.groups[0].items[0].status).toBe("LAST_CORRECT");
});

test("sınav sorusu da girer; kaynağı kaldırılan (redacted) soru girmez", async () => {
  const pdf = await h.uploadOk("ayse", h.world.courses.vy, { name: "a.pdf" });
  await h.makeReady(pdf.id, ["bir", "iki"]);
  const mid = "pdf_" + pdf.id;
  const u = h.world.users.ayse, c = h.world.courses.vy;
  await wrongAnswer("e1", u, c, mid, 1, "REVIEW_SOURCE", { purpose: "EXAM" });
  await wrongAnswer("r1", u, c, mid, 2, "REVIEW_SOURCE", { redacted: true });
  const r = await h.http().get(`/courses/${c}/review`).set(await h.as("ayse"));
  const items = r.body.groups.flatMap((g: any) => g.items);
  expect(items.map((i: any) => [i.quiz_id, i.purpose])).toEqual([["e1", "EXAM"]]);
});

test("başka kullanıcının verisi karışmaz", async () => {
  const pdf = await h.uploadOk("ayse", h.world.courses.vy, { name: "a.pdf" });
  await h.makeReady(pdf.id, ["bir", "iki"]);
  const mid = "pdf_" + pdf.id;
  await wrongAnswer("m1", h.world.users.mehmet, h.world.courses.vy, mid, 1);
  const r = await h.http().get(`/courses/${h.world.courses.vy}/review`).set(await h.as("ayse"));
  expect(r.status).toBe(200);
  expect(r.body.counts).toEqual({ open: 0, last_correct: 0 });
  expect(r.body.groups).toEqual([]);
});

test("üye olmayan kullanıcı için ders 404; kimliksiz istek reddedilir", async () => {
  expect((await h.http().get(`/courses/${h.world.courses.vy}/review`).set(await h.as("outsider"))).status).toBe(404);
  expect((await h.http().get(`/courses/${h.world.courses.os}/review`).set(await h.as("ayse"))).status).toBe(404);
  expect((await h.http().get(`/courses/${h.world.courses.vy}/review`)).status).toBe(401);
});
