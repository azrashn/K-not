/** Real SQL and HTTP/auth; retrieval/model boundary is explicitly fake. */
import { createHash } from "node:crypto";
import { Harness } from "../support/harness";
import { STUDY_FILE_MAX_BYTES } from "../../src/common/limits";
import { FakeAiService } from "../support/fake-ai";
const h = new Harness();
const engine = new FakeAiService();
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
  await h.prisma.studyMaterial.create({
    data: {
      id: "water-notes",
      courseId: h.world.courses.vy,
      ownerId: h.world.users.ayse,
      kind: "TXT",
      title: "Physics notes",
      filename: "physics.txt",
      sha256: "a".repeat(64),
      segments: [
        {
          text: "Evaporation changes liquid water to vapour.",
          location: { kind: "text", section: 1 },
        },
      ],
    },
  });
  h.ai.on("POST", "/api/v1/knowledge/state", () => ({
    status: 200,
    body: { versions: {} },
  }));
  h.ai.on("POST", "/api/v1/knowledge/index", () => ({
    status: 200,
    body: { indexed: 1 },
  }));
  h.ai.on("POST", "/api/v1/knowledge/search", (r) => {
    const m = r.body.materials[0],
      location = { kind: "text", section: 1 },
      text = "Evaporation changes liquid water to vapour.";
    const id = createHash("sha256")
      .update(m.id + m.version + JSON.stringify(location) + text)
      .digest("hex");
    return {
      status: 200,
      body: {
        evidence: [
          {
            id,
            text,
            location,
            material_id: m.id,
            version: m.version,
            kind: m.kind,
          },
        ],
        associations: [],
        conflicts: [],
      },
    };
  });
  h.ai.on("POST", "/api/v1/knowledge/explain", () => ({
    status: 200,
    body: {
      status: "SOURCE_EXCERPTS",
      answer: "[1] Source text",
      llm_used: false,
    },
  }));
});
const route = () => `/courses/${h.world.courses.vy}/knowledge`;

test("visible page4 and typed multi-source scope reach search, unrelated page/source IDs are rejected", async () => {
  const pdf = await h.uploadOk("ayse", h.world.courses.vy, {
    name: "graphs.pdf",
  });
  await h.makeReady(pdf.id, [
    "Introduction",
    "Graph representation",
    "Search methods",
    "Diagram with nodes A B C",
  ]);
  h.ai.on("POST", "/api/v1/knowledge/search", (r) => ({
    status: 200,
    body: {
      evidence: r.body.context_evidence,
      associations: [],
      conflicts: [],
      debug: { context_state: "VIEWPORT" },
    },
  }));
  const b = {
    question: "Alttaki örnekte sırayı açıkla",
    active_material_id: "pdf_" + pdf.id,
    viewport: { kind: "page", page: 4 },
    scope: {
      mode: "selected",
      material_ids: ["pdf_" + pdf.id, "file_water-notes"],
    },
  };
  const answer = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send(b)
    .expect(200);
  expect(answer.body.evidence[0].location.page).toBe(4);
  expect(answer.body.resolved_context.viewport.page).toBe(4);
  expect(answer.body.retrieval.searched).toHaveLength(2);
  expect(
    h.ai.calls("POST", "/api/v1/knowledge/search").at(-1)!.body
      .context_evidence[0].location.page,
  ).toBe(4);
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ ...b, viewport: { kind: "page", page: 7 } })
    .expect(422);
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ ...b, scope: { mode: "selected", material_ids: ["pdf_foreign"] } })
    .expect(404);
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ ...b, explicit_source_ids: ["f".repeat(64)] })
    .expect(404);
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({
      ...b,
      viewport: { kind: "page", page: 4, selected_text: "Diagram with nodes" },
    })
    .expect(200);
  expect(
    h.ai.calls("POST", "/api/v1/knowledge/search").at(-1)!.body.selected_text,
  ).toBe("Diagram with nodes");
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({
      ...b,
      viewport: {
        kind: "page",
        page: 4,
        selected_text: "A fabricated source selection",
      },
    })
    .expect(422);
});

test("an empty PDF page has an independent viewport marker, not an invented OCR transcript", async () => {
  const pdf = await h.uploadOk("ayse", h.world.courses.vy, {
    name: "empty-page.pdf",
  });
  await h.makeReady(pdf.id, ["Visible introduction", ""]);
  h.ai.on("POST", "/api/v1/knowledge/search", (r) => ({
    status: 200,
    body: {
      evidence: r.body.context_evidence,
      associations: [],
      conflicts: [],
    },
  }));
  const r = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({
      question: "Bu sayfadaki bağlam nedir?",
      active_material_id: "pdf_" + pdf.id,
      viewport: { kind: "page", page: 2 },
    })
    .expect(200);
  expect(r.body.resolved_context.viewport.page).toBe(2);
  expect(r.body.evidence[0].location.empty).toBe(true);
});

test("persistent chat survives expired transient receipt, retains follow-up and isolates users", async () => {
  const first = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  const chat = first.body.chat_id;
  expect(chat).toMatch(/^[a-f0-9-]{36}$/);
  const list = await h
    .http()
    .get(route() + "/conversations")
    .set(await h.as("ayse"))
    .expect(200);
  expect(list.body[0].id).toBe(chat);
  const saved = await h
    .http()
    .get(route() + "/conversations/" + chat)
    .set(await h.as("ayse"))
    .expect(200);
  expect(saved.body.messages).toHaveLength(2);
  expect(saved.body.messages[1].payload.conversation_id).toBeUndefined();
  await h
    .http()
    .get(route() + "/conversations/" + chat)
    .set(await h.as("mehmet"))
    .expect(404);
  const follow = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Bir örnek göster", chat_id: chat })
    .expect(200);
  expect(follow.body.resolved_question).toContain("Evaporation");
  expect(follow.body.chat_id).toBe(chat);
  expect(await h.prisma.learningMessage.count()).toBe(4);
  await h
    .http()
    .delete(route() + "/materials/file_water-notes")
    .set(await h.as("ayse"))
    .expect(200);
  const gone = await h
    .http()
    .get(route() + "/conversations/" + chat)
    .set(await h.as("ayse"))
    .expect(200);
  expect(
    gone.body.messages
      .filter((m: any) => m.role === "assistant")
      .every((m: any) => m.redacted && m.payload.evidence.length === 0),
  ).toBe(true);
});
test("changed material versions redact stored message text when reopening history", async () => {
  const first = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  await h.prisma.studyMaterial.update({
    where: { id: "water-notes" },
    data: { sha256: "b".repeat(64) },
  });
  const saved = await h
    .http()
    .get(route() + "/conversations/" + first.body.chat_id)
    .set(await h.as("ayse"))
    .expect(200);
  expect(saved.body.messages[1].redacted).toBe(true);
  expect(saved.body.messages[1].payload.evidence).toEqual([]);
});
test("durable chat rehydrates page/slide location after MySQL JSON key normalization", async () => {
  const pdf = await h.uploadOk("ayse", h.world.courses.vy, {
    name: "water.pdf",
  });
  const text = "Evaporation changes liquid water to vapour.";
  await h.makeReady(pdf.id, [text]);
  h.ai.on("POST", "/api/v1/knowledge/search", (r) => {
    const m = r.body.materials.find((m: any) => m.kind === "PDF"),
      location = {
        kind: "page",
        page: 1,
        char_start: 0,
        char_end: text.length,
      };
    return {
      status: 200,
      body: {
        evidence: [
          {
            id: createHash("sha256")
              .update(m.id + m.version + JSON.stringify(location) + text)
              .digest("hex"),
            text,
            location,
            material_id: m.id,
            version: m.version,
            kind: m.kind,
          },
        ],
      },
    };
  });
  const first = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  const saved = await h
    .http()
    .get(route() + "/conversations/" + first.body.chat_id)
    .set(await h.as("ayse"))
    .expect(200);
  expect(
    Object.keys(saved.body.messages[1].payload.evidence[0].location),
  ).not.toEqual(Object.keys(first.body.evidence[0].location));
  const follow = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Bir örnek göster", chat_id: first.body.chat_id })
    .expect(200);
  expect(follow.body.evidence[0].location.page).toBe(1);
});
test("material rename is owner scoped and leaves original bytes/content unchanged", async () => {
  await h
    .http()
    .patch(route() + "/materials/file_water-notes")
    .set(await h.as("mehmet"))
    .send({ title: "hijack" })
    .expect(404);
  await h
    .http()
    .patch(route() + "/materials/file_water-notes")
    .set(await h.as("ayse"))
    .send({ title: "Renamed physics" })
    .expect(200);
  const m = await h.prisma.studyMaterial.findUniqueOrThrow({
    where: { id: "water-notes" },
  });
  expect(m.title).toBe("Renamed physics");
  expect(m.sha256).toBe("a".repeat(64));
  expect(m.filename).toBe("physics.txt");
  const r = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  expect(r.body.evidence[0].title).toBe("Renamed physics");
});
test("unprocessed PDF cannot bypass ingestion validation through the visual endpoint", async () => {
  const pdf = await h.uploadOk("ayse", h.world.courses.vy, {
    name: "not-ready.pdf",
  });
  await h
    .http()
    .get(route() + `/materials/pdf_${pdf.id}/visual/1`)
    .set(await h.as("ayse"))
    .expect(404);
  expect(h.ai.calls("POST", "/api/v1/knowledge/render")).toHaveLength(0);
});

test("a saved older answer can be reformulated after later turns, without following a foreign message", async () => {
  const first = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Another topic", chat_id: first.body.chat_id })
    .expect(200);
  const mode = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({
      question: "Evaporation",
      chat_id: first.body.chat_id,
      parent_message_id: first.body.message_id,
      response_mode: "short",
    })
    .expect(200);
  expect(mode.body.response_mode).toBe("short");
  expect(
    h.ai.calls("POST", "/api/v1/knowledge/explain").at(-1)!.body.response_mode,
  ).toBe("short");
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("mehmet"))
    .send({
      question: "Evaporation",
      chat_id: first.body.chat_id,
      parent_message_id: first.body.message_id,
      response_mode: "short",
    })
    .expect(404);
});
test("legacy visual output without a quality gate is not presented as a computed answer", async () => {
  const first = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  const row = await h.prisma.learningMessage.findUniqueOrThrow({
    where: { id: first.body.message_id },
  });
  await h.prisma.learningMessage.update({
    where: { id: row.id },
    data: {
      content: "Wrong visual sequence",
      payload: {
        ...(row.payload as any),
        answer: "Wrong visual sequence",
        visual_analysis: { status: "IMAGE_PROVIDED" },
      },
    },
  });
  const read = await h
    .http()
    .get(route() + "/conversations/" + first.body.chat_id)
    .set(await h.as("ayse"))
    .expect(200);
  expect(read.body.messages[1].content).not.toContain("Wrong visual");
  expect(read.body.messages[1].payload.status).toBe("CLARIFICATION");
});
test("active unwatched video guides first even with supplementary text, explanation permission is per request", async () => {
  const engineId = "up_abcdef1234";
  await h.prisma.video.create({
    data: {
      id: "policy-video",
      ownerId: h.world.users.ayse,
      courseId: h.world.courses.vy,
      engineVideoId: engineId,
      title: "Lesson",
      originalFilename: "a.mp4",
      contentSha256: "c".repeat(64),
      durationMs: 200000,
    },
  });
  await h.prisma.videoProgress.create({
    data: {
      videoId: "policy-video",
      userId: h.world.users.ayse,
      positionMs: 190000,
      intervals: [],
      revision: 1,
    },
  });
  engine.on("GET", "/api/videos/" + engineId, () => ({
    status: 200,
    body: { id: engineId, status: "indexed" },
  }));
  engine.on("GET", "/api/transcript/" + engineId, () => ({
    status: 200,
    body: {
      video_id: engineId,
      chunks: [
        {
          text: "Evaporation changes water to vapour.",
          t_start: 100,
          t_end: 120,
        },
      ],
    },
  }));
  h.ai.on("POST", "/api/v1/knowledge/search", (r) => ({
    status: 200,
    body: {
      evidence: [...r.body.materials]
        .sort(
          (a: any, b: any) =>
            Number(a.kind === "VIDEO") - Number(b.kind === "VIDEO"),
        )
        .map((m: any) => {
          const text =
              m.kind === "VIDEO"
                ? "Evaporation changes water to vapour."
                : "Evaporation changes liquid water to vapour.",
            location =
              m.kind === "VIDEO"
                ? {
                    kind: "video",
                    start_ms: 100000,
                    end_ms: 120000,
                    char_start: 0,
                    char_end: text.length,
                  }
                : { kind: "text", section: 1 };
          return {
            id: createHash("sha256")
              .update(m.id + m.version + JSON.stringify(location) + text)
              .digest("hex"),
            material_id: m.id,
            kind: m.kind,
            version: m.version,
            text,
            location,
          };
        }),
      associations: [],
      conflicts: [],
    },
  }));
  const b = {
    question: "Evaporation",
    active_material_id: "video_policy-video",
  };
  const first = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send(b)
    .expect(200);
  expect(first.body.status).toBe("GUIDANCE");
  const explicit = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({
      ...b,
      conversation_id: first.body.conversation_id,
      chat_id: first.body.chat_id,
      explain_now: true,
    })
    .expect(200);
  expect(explicit.body.status).toBe("SOURCE_EXCERPTS");
  const next = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ ...b, question: "Another topic", chat_id: first.body.chat_id })
    .expect(200);
  expect(next.body.status).toBe("GUIDANCE");
});
test("watched-only quiz rejects skipped/partial source spans and does not leak its answer before submission", async () => {
  const engineId = "up_0123abcdef";
  await h.prisma.video.create({
    data: {
      id: "watched-video",
      ownerId: h.world.users.ayse,
      courseId: h.world.courses.vy,
      engineVideoId: engineId,
      title: "Lesson",
      originalFilename: "a.mp4",
      contentSha256: "d".repeat(64),
      durationMs: 200000,
    },
  });
  await h.prisma.videoProgress.create({
    data: {
      videoId: "watched-video",
      userId: h.world.users.ayse,
      positionMs: 190000,
      intervals: [{ start_ms: 100000, end_ms: 110000 }],
      revision: 1,
    },
  });
  engine.on("GET", "/api/videos/" + engineId, () => ({
    status: 200,
    body: { id: engineId, status: "indexed" },
  }));
  const text = "Evaporation changes water to vapour.";
  engine.on("GET", "/api/transcript/" + engineId, () => ({
    status: 200,
    body: { video_id: engineId, chunks: [{ text, t_start: 100, t_end: 120 }] },
  }));
  h.ai.on("POST", "/api/v1/knowledge/search", (r) => {
    const m = r.body.materials[0],
      location = {
        kind: "video",
        start_ms: 100000,
        end_ms: 120000,
        char_start: 0,
        char_end: text.length,
      };
    return {
      status: 200,
      body: {
        evidence: [
          {
            id: createHash("sha256")
              .update(m.id + m.version + JSON.stringify(location) + text)
              .digest("hex"),
            material_id: m.id,
            kind: m.kind,
            version: m.version,
            text,
            location,
          },
        ],
        associations: [],
        conflicts: [],
      },
    };
  });
  h.ai.on("POST", "/api/v1/knowledge/quiz", () => ({
    status: 200,
    body: {
      kind: "CLOZE",
      question: "_____ changes water to vapour.",
      options: [],
      expected: "Evaporation",
      quote: text,
      source_index: 1,
      quality: {
        structural_validation: true,
        independent_model_review: true,
        option_audit_version: 2,
      },
    },
  }));
  const base = `/courses/${h.world.courses.vy}/quizzes`,
    b = { topic: "Evaporation", kind: "CLOZE", watched_only: true };
  await h
    .http()
    .post(base)
    .set(await h.as("ayse"))
    .send(b)
    .expect(422);
  expect(h.ai.calls("POST", "/api/v1/knowledge/quiz")).toHaveLength(0);
  expect(
    h.ai.calls("POST", "/api/v1/knowledge/search").at(-1)!.body
      .eligible_source_ids,
  ).toEqual([]);
  await h.prisma.videoProgress.update({
    where: {
      videoId_userId: { videoId: "watched-video", userId: h.world.users.ayse },
    },
    data: { intervals: [{ start_ms: 100000, end_ms: 120000 }] },
  });
  const q = await h
    .http()
    .post(base)
    .set(await h.as("ayse"))
    .send(b)
    .expect(201);
  expect(q.body.source.text).toBeUndefined();
  expect(q.body.expected).toBeUndefined();
  expect(q.body.watched_only).toBe(true);
  expect(
    h.ai.calls("POST", "/api/v1/knowledge/search").at(-1)!.body
      .eligible_source_ids,
  ).toHaveLength(1);
});
test("a rejected quality audit returns 422 without publishing a question", async () => {
  h.ai.on("POST", "/api/v1/knowledge/quiz", () => ({
    status: 422,
    body: { detail: "Quality gate rejected" },
  }));
  const before = await h.prisma.learningQuiz.count();
  await h
    .http()
    .post(`/courses/${h.world.courses.vy}/quizzes`)
    .set(await h.as("ayse"))
    .send({ topic: "Evaporation", kind: "MULTIPLE_CHOICE" })
    .expect(422);
  expect(await h.prisma.learningQuiz.count()).toBe(before);
});
test("quiz answers persist, wrong-source recommendation clears after correction, open response has no invented grade", async () => {
  h.ai.on("POST", "/api/v1/knowledge/quiz", (r) => ({
    status: 200,
    body: {
      quality: {
        structural_validation: true,
        independent_model_review: true,
        option_audit_version: 2,
      },
      source_index: 1,
      kind: r.body.kind,
      question: "Complete: _____ changes liquid water to vapour.",
      options: [],
      expected: r.body.kind === "OPEN" ? "" : "Evaporation",
      quote: r.body.evidence[0].text,
    },
  }));
  const base = `/courses/${h.world.courses.vy}/quizzes`;
  const q = await h
    .http()
    .post(base)
    .set(await h.as("ayse"))
    .send({ topic: "Evaporation", kind: "CLOZE" })
    .expect(201);
  expect(q.body.expected).toBeUndefined();
  expect(q.body.quote).toBeUndefined();
  expect(q.body.option_feedback).toBeUndefined();
  expect(q.body.source.text).toBeUndefined();
  await h
    .http()
    .get(base + "/" + q.body.id)
    .set(await h.as("mehmet"))
    .expect(404);
  const answer = base + "/" + q.body.id + "/answers";
  await h
    .http()
    .post(answer)
    .set(await h.as("ayse"))
    .send({ response: "wrong" })
    .expect(200)
    .expect((r) => expect(r.body.score).toBe(0));
  let overview = await h
    .http()
    .get("/learning/overview")
    .set(await h.as("ayse"))
    .expect(200);
  expect(overview.body.recommendation.source.material_id).toBe(
    "file_water-notes",
  );
  await h
    .http()
    .post(answer)
    .set(await h.as("ayse"))
    .send({ response: "Evaporation" })
    .expect(200);
  overview = await h
    .http()
    .get("/learning/overview")
    .set(await h.as("ayse"))
    .expect(200);
  expect(overview.body.recommendation).toBeNull();
  expect(overview.body.correct_count).toBe(1);
  expect(overview.body.mastery_estimated).toBe(false);
  const open = await h
    .http()
    .post(base)
    .set(await h.as("ayse"))
    .send({ topic: "Evaporation", kind: "OPEN" })
    .expect(201);
  await h
    .http()
    .post(base + "/" + open.body.id + "/answers")
    .set(await h.as("ayse"))
    .send({ response: "My reflection" })
    .expect(200)
    .expect((r) => expect(r.body.score).toBeNull());
  await h
    .http()
    .delete(route() + "/materials/file_water-notes")
    .set(await h.as("ayse"))
    .expect(200);
  await h
    .http()
    .get(base + "/" + q.body.id)
    .set(await h.as("ayse"))
    .expect(404);
  expect(
    (
      await h
        .http()
        .get("/learning/overview")
        .set(await h.as("ayse"))
    ).body.attempts,
  ).toEqual([]);
  expect(
    (await h.prisma.learningQuizAttempt.findMany()).every(
      (a) => (a.feedback as any).source_removed,
    ),
  ).toBe(true);
});

test("typed material source and scoped manifest reach retrieval, no invented mastery", async () => {
  const r = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "What is evaporation?" })
    .expect(200);
  expect(r.body.status).toBe("SOURCE_EXCERPTS");
  expect(r.body.support_confirmed).toBe(false);
  expect(r.body.video_learning).toEqual([]);
  const e = r.body.evidence[0];
  await h
    .http()
    .get(route() + `/materials/${e.material_id}/sources/${e.id}`)
    .set(await h.as("ayse"))
    .expect(200);
  expect(
    h.ai.calls("POST", "/api/v1/knowledge/search")[0].body.materials,
  ).toHaveLength(1);
});
test("shared search endpoint retrieves real-scoped evidence without generating an answer", async () => {
  const r = await h
    .http()
    .post(route() + "/search")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  expect(r.body.status).toBe("EVIDENCE_ONLY");
  expect(r.body.evidence).toHaveLength(1);
  expect(h.ai.calls("POST", "/api/v1/knowledge/explain")).toHaveLength(0);
});
test("unwatched video does not block an explanation supported by another course material", async () => {
  const id = "water-video",
    engineId = "up_0123456789";
  await h.prisma.video.create({
    data: {
      id,
      ownerId: h.world.users.ayse,
      courseId: h.world.courses.vy,
      engineVideoId: engineId,
      title: "Water lesson",
      originalFilename: "water.mp4",
      contentSha256: "b".repeat(64),
      durationMs: 200000,
    },
  });
  await h.prisma.videoProgress.create({
    data: {
      videoId: id,
      userId: h.world.users.ayse,
      intervals: [],
      positionMs: 0,
      revision: 1,
    },
  });
  engine.on("GET", "/api/videos/" + engineId, () => ({
    status: 200,
    body: { id: engineId, status: "indexed" },
  }));
  engine.on("GET", "/api/transcript/" + engineId, () => ({
    status: 200,
    body: {
      video_id: engineId,
      chunks: [
        {
          text: "Evaporation changes water to vapour.",
          t_start: 100,
          t_end: 120,
        },
      ],
    },
  }));
  h.ai.on("POST", "/api/v1/knowledge/search", (r) => ({
    status: 200,
    body: {
      evidence: r.body.materials.map((m: any) => {
        const text =
          m.kind === "VIDEO"
            ? "Evaporation changes water to vapour."
            : "Evaporation changes liquid water to vapour.";
        const location =
          m.kind === "VIDEO"
            ? {
                kind: "video",
                start_ms: 100000,
                end_ms: 120000,
                char_start: 0,
                char_end: text.length,
              }
            : { kind: "text", section: 1 };
        return {
          id: createHash("sha256")
            .update(m.id + m.version + JSON.stringify(location) + text)
            .digest("hex"),
          material_id: m.id,
          version: m.version,
          kind: m.kind,
          text,
          location,
        };
      }),
      associations: [],
      conflicts: [],
    },
  }));
  const r = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  expect(r.body.video_learning[0].state).toBe("UNWATCHED");
  expect(r.body.status).toBe("SOURCE_EXCERPTS");
  expect(h.ai.calls("POST", "/api/v1/knowledge/explain")).toHaveLength(1);
});
test("private material invisible to other member and foreign course is rejected", async () => {
  const list = await h
    .http()
    .get(route() + "/materials")
    .set(await h.as("instructor"))
    .expect(200);
  expect(list.body.materials).toEqual([]);
  await h
    .http()
    .get(route() + "/materials/file_water-notes")
    .set(await h.as("instructor"))
    .expect(404);
  await h
    .http()
    .get(route() + "/materials")
    .set(await h.as("outsider"))
    .expect(404);
  await h
    .http()
    .get(route() + "/materials")
    .expect(401);
});
test("upstream foreign or fabricated source fails closed before generation", async () => {
  h.ai.on("POST", "/api/v1/knowledge/search", () => ({
    status: 200,
    body: {
      evidence: [
        { id: "a".repeat(64), material_id: "file_foreign", kind: "TXT" },
      ],
    },
  }));
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(500);
  expect(h.ai.calls("POST", "/api/v1/knowledge/explain")).toHaveLength(0);
});
test("an association cannot smuggle a source outside the authorized evidence", async () => {
  const r = await h
    .http()
    .post(route() + "/search")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  const evidence = r.body.evidence.map(
    ({ n: _n, source_id: _source_id, ...e }: any) => e,
  );
  h.ai.on("POST", "/api/v1/knowledge/search", () => ({
    status: 200,
    body: {
      evidence,
      associations: [
        {
          kind: "RELATED_TOPIC",
          source_ids: [evidence[0].id, "foreign-source"],
        },
      ],
    },
  }));
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(500);
  expect(h.ai.calls("POST", "/api/v1/knowledge/explain")).toHaveLength(0);
});
test("conversation owner scope and deleted source receipt are enforced", async () => {
  const first = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  const body = {
    question: "İkinci adımı açıkla",
    conversation_id: first.body.conversation_id,
  };
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("instructor"))
    .send(body)
    .expect(404);
  const follow = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send(body)
    .expect(200);
  expect(follow.body.resolved_question).toContain("Evaporation");
  expect(
    h.ai.calls("POST", "/api/v1/knowledge/explain").at(-1)!.body
      .conversation_context,
  ).toBe("[1] Source text");
  await h
    .http()
    .delete(route() + "/materials/file_water-notes")
    .set(await h.as("ayse"))
    .expect(200);
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send(body)
    .expect(404);
  expect(await h.prisma.studyMaterial.count()).toBe(0);
});
test("client identity/watch spoofing and oversized file rejected", async () => {
  await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "x", watched_percent: 100 })
    .expect(422);
  await h
    .http()
    .post(route() + "/materials")
    .set(await h.as("ayse"))
    .attach("file", Buffer.alloc(STUDY_FILE_MAX_BYTES + 1), "too-big.txt")
    .expect(413);
});
test("new original text file survives duplicate upload and is removed with its material", async () => {
  h.ai.on("POST", "/api/v1/knowledge/extract", () => ({
    status: 200,
    body: {
      segments: [
        {
          text: "Physics original file.",
          location: { kind: "text", section: 1 },
        },
      ],
    },
  }));
  const upload = () => h.http().post(route() + "/materials");
  const stored = await upload()
    .set(await h.as("ayse"))
    .attach("file", Buffer.from("Physics original file."), "new.txt")
    .expect(201);
  const original = route() + "/materials/" + stored.body.id + "/file";
  await upload()
    .set(await h.as("ayse"))
    .attach("file", Buffer.from("Physics original file."), "new.txt")
    .expect(409);
  const file = await h
    .http()
    .get(original)
    .set(await h.as("ayse"))
    .expect(200);
  expect(file.text).toBe("Physics original file.");
  await h
    .http()
    .get(original)
    .set(await h.as("instructor"))
    .expect(404);
  await h
    .http()
    .delete(route() + "/materials/" + stored.body.id)
    .set(await h.as("ayse"))
    .expect(200);
  await h
    .http()
    .get(original)
    .set(await h.as("ayse"))
    .expect(404);
});
test("practice is source-bound, literal feedback is not a mastery claim, deleted source invalidates it", async () => {
  const first = await h
    .http()
    .post(route() + "/answers")
    .set(await h.as("ayse"))
    .send({ question: "Evaporation" })
    .expect(200);
  const p = await h
    .http()
    .post(route() + "/practice")
    .set(await h.as("ayse"))
    .send({ conversation_id: first.body.conversation_id })
    .expect(200);
  expect(p.body.prompt).toContain("_____");
  expect(p.body.expected).toBeUndefined();
  const answerRoute = route() + "/practice/" + p.body.id + "/answers";
  const wrong = await h
    .http()
    .post(answerRoute)
    .set(await h.as("ayse"))
    .send({ answer: "wrong" })
    .expect(200);
  expect(wrong.body.outcome).toBe("REVIEW_SOURCE");
  expect(wrong.body.mastery_estimated).toBe(false);
  await h
    .http()
    .post(answerRoute)
    .set(await h.as("instructor"))
    .send({ answer: "Evaporation" })
    .expect(404);
  const correct = await h
    .http()
    .post(answerRoute)
    .set(await h.as("ayse"))
    .send({ answer: wrong.body.expected })
    .expect(200);
  expect(correct.body.outcome).toBe("EXACT_MATCH");
  expect(correct.body.persisted).toBe(false);
  await h
    .http()
    .delete(route() + "/materials/file_water-notes")
    .set(await h.as("ayse"))
    .expect(200);
  await h
    .http()
    .post(answerRoute)
    .set(await h.as("ayse"))
    .send({ answer: "Evaporation" })
    .expect(404);
});
test("find searches the text of one material, keeps locations, and is scoped to who may see it", async () => {
  const list = await h.http().get(`${route()}/materials`).set(await h.as("ayse")).expect(200);
  const id = list.body.materials.find((m: any) => m.title === "Physics notes").id;
  const find = (q: string) => `${route()}/materials/${id}/find?q=${encodeURIComponent(q)}`;
  const hit = await h.http().get(find("EVAPORATION")).set(await h.as("ayse")).expect(200);
  expect(hit.body.hits).toHaveLength(1);
  expect(hit.body.hits[0]).toMatchObject({ location: { kind: "text", section: 1 }, count: 1 });
  expect(hit.body.hits[0].snippet).toContain("Evaporation changes liquid water");
  expect(hit.body.hits[0].snippet.slice(hit.body.hits[0].match_start, hit.body.hits[0].match_end)).toBe("Evaporation");
  expect((await h.http().get(find("nothing like this")).set(await h.as("ayse")).expect(200)).body.hits).toEqual([]);
  await h.http().get(find("a")).set(await h.as("ayse")).expect(422);
  await h.http().get(`${route()}/materials/${id}/find`).set(await h.as("ayse")).expect(422);
  // a private material of one student is not searchable by another member
  await h.http().get(find("evaporation")).set(await h.as("mehmet")).expect(404);
  await h.http().get(find("evaporation")).expect(401);
});
describe("links: page <-> video moments", () => {
  const link = {
    material_id: "video_x", title: "Ders", kind: "VIDEO",
    location: { kind: "video", start_ms: 1000, end_ms: 9000 }, shared_terms: ["TCP"], preview: "x", estimated: true,
  };
  const readyPdf = async () => {
    const pdf = await h.uploadOk("ayse", h.world.courses.vy, { name: "net.pdf" });
    await h.makeReady(pdf.id, ["TCP kurulumu"]);
    return "pdf_" + pdf.id;
  };
  const url = (id: string, qs: string) => `${route()}/materials/${id}/links${qs}`;
  beforeEach(() => {
    h.ai.on("POST", "/api/v1/knowledge/links", () => ({ status: 200, body: { links: [link, link, link, link] } }));
  });
  test("returns at most three estimated links and caches the repeat call", async () => {
    const id = await readyPdf();
    const first = await h.http().get(url(id, "?page=1")).set(await h.as("ayse")).expect(200);
    expect(first.body.links).toHaveLength(3);
    expect(first.body.links[0].estimated).toBe(true);
    expect(first.body.preparing).toBe(false);
    const sent = h.ai.calls("POST", "/api/v1/knowledge/links");
    expect(sent[0].body).toMatchObject({ material_id: id, page: 1, course_id: h.world.courses.vy });
    await h.http().get(url(id, "?page=1")).set(await h.as("ayse")).expect(200);
    expect(h.ai.calls("POST", "/api/v1/knowledge/links")).toHaveLength(1);
    await h.http().get(url(id, "?page=2")).set(await h.as("ayse")).expect(200);
    expect(h.ai.calls("POST", "/api/v1/knowledge/links")).toHaveLength(2);
  });
  test("another user's material is 404 and unauthenticated is 401", async () => {
    const id = await readyPdf();
    await h.http().get(url(id, "?page=1")).set(await h.as("mehmet")).expect(404);
    await h.http().get(url(id, "?page=1")).expect(401);
  });
  test("invalid page / time_ms, both, none, or the wrong material kind are 422", async () => {
    const id = await readyPdf();
    for (const qs of ["", "?page=0", "?page=abc", "?page=1.5", "?page=501", "?time_ms=-1", "?page=1&time_ms=5", "?time_ms=5", "?x=1"])
      await h.http().get(url(id, qs)).set(await h.as("ayse")).expect(422);
    await h.http().get(url("file_water-notes", "?page=1")).set(await h.as("ayse")).expect(422);
    expect(h.ai.calls("POST", "/api/v1/knowledge/links")).toHaveLength(0);
  });
});
test("the upload limits the server enforces are published to signed-in users", async () => {
  const res = await h.http().get("/limits").set(await h.as("ayse")).expect(200);
  expect(res.body).toEqual({
    document_bytes: expect.any(Number),
    study_file_bytes: STUDY_FILE_MAX_BYTES,
    video_bytes: expect.any(Number),
  });
  await h.http().get("/limits").expect(401);
});

describe("board steps (additive field)", () => {
  const ask = async () =>
    (await h.http().post(route() + "/answers").set(await h.as("ayse")).send({ question: "Evaporation" }).expect(200)).body;
  const explain = (body: object) =>
    h.ai.on("POST", "/api/v1/knowledge/explain", () => ({ status: 200, body }));

  test("no model: steps come from the evidence, verbatim, with the evidence id", async () => {
    const body = await ask();
    expect(body.status).toBe("SOURCE_EXCERPTS");
    expect(body.answer).toBe("[1] Source text");
    expect(body.steps_status).toBe("EVIDENCE");
    expect(body.steps).toEqual([
      {
        board: "Evaporation changes liquid water to vapour",
        speech: "Evaporation changes liquid water to vapour.",
        formula: null,
        mark: null,
        sources: [body.evidence[0].id],
        source_ids: [1],
        quote: "Evaporation changes liquid water to vapour.",
      },
    ]);
  });

  test("valid model steps are kept, foreign sources dropped", async () => {
    const first = await ask();
    const id = first.evidence[0].id;
    explain({
      status: "GENERATED_UNVERIFIED",
      answer: "Water becomes vapour. [1]",
      llm_used: true,
      claims: [{ text: "Water becomes vapour.", sources: [1] }],
      steps_status: "MODEL",
      steps_summary: "Water becomes vapour.",
      steps: [
        { board: "Water → vapour", speech: "Liquid water changes to vapour.", formula: null, mark: "circle", sources: [id], source_ids: [1], quote: "liquid water to vapour" },
        { board: "Foreign", speech: "Not from this answer.", formula: null, mark: null, sources: ["f".repeat(64)], source_ids: [1] },
      ],
    });
    const body = await ask();
    expect(body.answer).toBe("Water becomes vapour. [1]");
    expect(body.steps_status).toBe("MODEL");
    expect(body.steps_summary).toBe("Water becomes vapour.");
    expect(body.steps.map((s: any) => s.board)).toEqual(["Water → vapour"]);
    expect(body.steps[0].quote).toBe("liquid water to vapour");
  });

  test.each([
    [{ status: "GENERATED_UNVERIFIED", answer: "Water. [1]", llm_used: true, claims: [], steps: [], steps_status: "INVALID" }],
    [{ status: "GENERATED_UNVERIFIED", answer: "Water. [1]", llm_used: true, claims: [], steps: [], steps_status: "FAILED" }],
    [{ status: "INVALID_CITATIONS", answer: "[1] Source text", llm_used: true }],
    [{ status: "GENERATION_FAILED_SOURCE_EXCERPTS", answer: "[1] Source text", llm_used: false }],
  ])("model could not give steps → evidence steps (%j)", async (generated) => {
    explain(generated);
    const body = await ask();
    expect(body.status).toBe(generated.status);
    expect(body.steps_status).toBe("EVIDENCE");
    expect(body.steps).toHaveLength(1);
    expect(body.steps_summary).toBeUndefined();
  });

  test.each(["CLARIFICATION", "MODE_NOT_SATISFIED", "NO_EVIDENCE"])("%s gets no steps", async (status) => {
    explain({ status, answer: "Hangi bölümü kastediyorsun?", llm_used: false });
    const body = await ask();
    expect(body.steps).toEqual([]);
    expect(body.steps_status).toBe("NONE");
  });

  test("steps are saved with the conversation", async () => {
    const body = await ask();
    const saved = await h.http().get(route() + "/conversations/" + body.chat_id).set(await h.as("ayse")).expect(200);
    expect(saved.body.messages[1].payload.steps).toEqual(body.steps);
  });
});

describe("self-check: the student's own text against the course materials", () => {
  const url = () => `${route()}/self-check`;
  const sid = "d".repeat(64);
  const readyPdf = async () => {
    const pdf = await h.uploadOk("ayse", h.world.courses.vy, { name: "net.pdf" });
    await h.makeReady(pdf.id, ["TCP kurulumu"]);
    return "pdf_" + pdf.id;
  };
  const answer = (materialId: string) => ({
    claims: [
      { text: "TCP üç yollu el sıkışma kullanır", label: "IN_SOURCE", translated: true, matched_terms: ["TCP", "SYN"], missing_terms: [], unmatched_numbers: [], conflict: null,
        sources: [{ source_id: sid, material_id: materialId, title: "x", kind: "PDF", location: { page: 4 }, quote: "q".repeat(300) },
                  { source_id: sid, material_id: "pdf_someone-elses", title: "leak", kind: "PDF", location: { page: 1 }, quote: "no" }] },
      // a conflict whose only source belongs to a material the student cannot read must not survive
      { text: "başka", label: "CONFLICTS", missing_terms: [], unmatched_numbers: [], conflict: { kind: "NUMBER", claim: ["1"], source: ["2"] },
        sources: [{ source_id: sid, material_id: "pdf_someone-elses", title: "leak", kind: "PDF", location: { page: 1 }, quote: "no" }] },
    ],
    skipped: [{ text: "Bu nasıl?", reason: "QUESTION" }],
    summary: { IN_SOURCE: 99, total: 99 },
    truncated: false,
  });
  beforeEach(() => {
    h.ai.on("POST", "/api/v1/knowledge/self-check", () => ({ status: 200, body: {} }));
  });

  test("forwards the text with the course manifest and returns only sources the student may read", async () => {
    const id = await readyPdf();
    h.ai.on("POST", "/api/v1/knowledge/self-check", () => ({ status: 200, body: answer(id) }));
    const res = await h.http().post(url()).set(await h.as("ayse")).send({ text: "TCP üç yollu el sıkışma kullanır." }).expect(200);
    const sent = h.ai.calls("POST", "/api/v1/knowledge/self-check");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ course_id: h.world.courses.vy, text: "TCP üç yollu el sıkışma kullanır." });
    expect(sent[0].body.materials.map((m: any) => m.id)).toContain(id);
    expect(res.body.claims[0].sources).toHaveLength(1);
    expect(res.body.claims[0].sources[0]).toMatchObject({ material_id: id, location: { page: 4 } });
    expect(res.body.claims[0].sources[0].quote).toHaveLength(160);
    expect(res.body.claims[0]).toMatchObject({ translated: true, matched_terms: ["TCP", "SYN"] });
    // the conflicting claim lost its only source: it is reported as not found, never as a conflict
    expect(res.body.claims[1]).toMatchObject({ label: "NOT_IN_SOURCE", conflict: null, sources: [] });
    // counts come from the cleaned claims, not from the service's own numbers
    expect(res.body.summary).toEqual({ IN_SOURCE: 1, NOT_IN_SOURCE: 1, CONFLICTS: 0, PARTIAL: 0, UNCHECKED: 0, total: 2 });
    expect(JSON.stringify(res.body)).not.toMatch(/score|percent/i);
  });

  test("empty, blank, missing, too long or malformed input is 422 and never reaches the ai service", async () => {
    await readyPdf();
    for (const body of [{}, { text: "" }, { text: "   \n " }, { text: "a".repeat(4001) }, { text: 5 },
      { text: "x", material_ids: ["../x"] }, { text: "x", unknown: 1 }])
      await h.http().post(url()).set(await h.as("ayse")).send(body).expect(422);
    expect(h.ai.calls("POST", "/api/v1/knowledge/self-check")).toHaveLength(0);
    await h.http().post(url()).set(await h.as("ayse")).send({ text: "a".repeat(4000) }).expect(200);
  });

  test("a non-member gets 404, a classmate never compares against private material, unauthenticated is 401", async () => {
    await readyPdf();
    await h.http().post(url()).set(await h.as("outsider")).send({ text: "TCP kurulumu yapılır." }).expect(404);
    // a classmate sees none of ayse's private material: there is nothing to compare with
    await h.http().post(url()).set(await h.as("mehmet")).send({ text: "TCP kurulumu yapılır." }).expect(422);
    await h.http().post(url()).send({ text: "TCP kurulumu yapılır." }).expect(401);
    expect(h.ai.calls("POST", "/api/v1/knowledge/self-check")).toHaveLength(0);
  });

  test("a selected material the student cannot see is 404; a course without ready material is 422", async () => {
    await h.http().post(url()).set(await h.as("ayse")).send({ text: "x", material_ids: ["pdf_nobody"] }).expect(404);
    await h.prisma.studyMaterial.deleteMany({});
    await h.http().post(url()).set(await h.as("ayse")).send({ text: "TCP kurulumu yapılır." }).expect(422);
  });

  test("the service being down is a Turkish error in the standard shape", async () => {
    await readyPdf();
    h.ai.on("POST", "/api/v1/knowledge/self-check", () => ({ status: 500, body: {} }));
    const res = await h.http().post(url()).set(await h.as("ayse")).send({ text: "TCP kurulumu yapılır." });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.error?.code ?? res.body.code).toBe("AI_SERVICE_UNAVAILABLE");
  });
});
