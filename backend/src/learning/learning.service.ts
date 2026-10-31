import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/request-context";
import { ApiError, notFound } from "../common/errors";
import { AccessService } from "../courses/access.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { AiServiceClient } from "../ai/ai-client";

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiServiceClient,
  ) {}
  async activity(u: AuthUser, c: string, body: any) {
    await this.access.requireMember(u, c);
    if (body.material_id) {
      const m = (await this.knowledge.materials(u, c)).find(
        (m) => m.id === body.material_id,
      );
      if (!m) throw notFound("Material");
    }
    if (body.segment_id)
      await this.knowledge.source(u, c, body.material_id, body.segment_id);
    return this.prisma.learningActivity.upsert({
      where: { userId_courseId: { userId: u.id, courseId: c } },
      create: {
        userId: u.id,
        courseId: c,
        materialId: body.material_id,
        segmentId: body.segment_id,
        events: 1,
      },
      update: {
        materialId: body.material_id,
        segmentId: body.segment_id,
        events: { increment: 1 },
      },
    });
  }
  async overview(u: AuthUser) {
    const scope = {
      userId: u.id,
      course: {
        lifecycle: "ACTIVE",
        memberships: { some: { userId: u.id, archivedAt: null } },
      },
    };
    const [activities, storedAttempts, quizzes, videos] = await Promise.all([
      this.prisma.learningActivity.findMany({
        where: scope,
        include: { course: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      this.prisma.learningQuizAttempt.findMany({
        where: {
          userId: u.id,
          quiz: {
            redacted: false,
            course: {
              lifecycle: "ACTIVE",
              memberships: { some: { userId: u.id, archivedAt: null } },
            },
          },
        },
        include: { quiz: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      this.prisma.learningQuiz.count({ where: { ...scope, redacted: false } }),
      this.prisma.videoProgress.findMany({
        where: {
          userId: u.id,
          video: {
            ownerId: u.id,
            course: {
              lifecycle: "ACTIVE",
              memberships: { some: { userId: u.id, archivedAt: null } },
            },
          },
        },
        include: {
          video: { select: { title: true, courseId: true, durationMs: true } },
        },
        take: 100,
      }),
    ]);
    const manifests = new Map(
      await Promise.all(
        [...new Set(storedAttempts.map((a) => a.quiz.courseId))].map(
          async (c) => [c, await this.knowledge.materials(u, c)] as const,
        ),
      ),
    );
    const attempts = storedAttempts.filter((a) =>
      manifests
        .get(a.quiz.courseId)
        ?.some(
          (m) =>
            m.id === a.quiz.materialId &&
            m.version === a.quiz.version &&
            m.status === "READY",
        ),
    );
    const graded = attempts.filter((a) => a.score !== null),
      correct = graded.filter((a) => a.score === 1).length;
    const latest = [
      ...new Map([...attempts].reverse().map((a) => [a.quizId, a])).values(),
    ];
    const review = latest.find((a) => a.outcome === "REVIEW_SOURCE");
    return {
      activities,
      attempts: attempts.map((a) => ({
        id: a.id,
        quiz_id: a.quizId,
        course_id: a.quiz.courseId,
        topic: a.quiz.topic,
        outcome: a.outcome,
        score: a.score,
        created_at: a.createdAt,
        source: (a.quiz.data as any).source,
      })),
      quiz_count: quizzes,
      graded_count: graded.length,
      correct_count: correct,
      video_progress: videos.map((v) => ({
        video_id: v.videoId,
        title: v.video.title,
        course_id: v.video.courseId,
        position_ms: v.positionMs,
        intervals: v.intervals,
        duration_ms: v.video.durationMs,
        updated_at: v.updatedAt,
      })),
      recommendation: review
        ? {
            course_id: review.quiz.courseId,
            topic: review.quiz.topic,
            source: (review.quiz.data as any).source,
          }
        : null,
      mastery_estimated: false,
    };
  }
  async start(u: AuthUser, c: string, b: any) {
    const found = await this.knowledge.ask(u, c, {
      question: b.topic,
      retrieve_only: true,
      scope: b.scope,
      watched_only: Boolean(b.watched_only),
      ...(b.material_id
        ? { strategy: "single", active_material_id: b.material_id }
        : {}),
    });
    const candidates = found.evidence
      .filter(
        (e: any) =>
          !b.watched_only ||
          found.video_learning.some(
            (l: any) => l.source_id === e.id && l.state === "WATCHED",
          ),
      )
      .slice(0, 4);
    let source = candidates[0];
    if (!source)
      throw new ApiError(
        "VALIDATION_ERROR",
        b.watched_only
          ? "Bu konuda tamamen izlenmiş video bölümü bulunamadı. Son oynatma konumu tek başına izleme kanıtı değildir."
          : "Bu konuda soru hazırlamaya uygun kaynak bulunamadı.",
      );
    const r = await this.ai.call("POST", "/api/v1/knowledge/quiz", {
      body: { question: b.topic, kind: b.kind, evidence: candidates },
      timeoutMs: 150000,
    });
    if (r.kind === "response" && r.status === 422)
      throw new ApiError(
        "VALIDATION_ERROR",
        "Soru kaynak, açıklık veya seçenek kalite kontrolünden geçmedi; yayınlanmadı. Başka bir bölüm veya soru türü deneyin.",
      );
    if (r.kind !== "response" || r.status !== 200)
      throw new ApiError(
        "GENERATION_FAILED",
        "Kaynakla doğrulanabilen soru hazırlanamadı. Başka bir bölüm veya soru türü deneyin.",
      );
    const q = r.body;
    if (
      !q.quality?.structural_validation ||
      !q.quality?.independent_model_review ||
      q.quality?.option_audit_version !== 2 ||
      !Number.isInteger(q.source_index) ||
      q.source_index < 1 ||
      q.source_index > candidates.length
    )
      throw new ApiError(
        "GENERATION_FAILED",
        "Soru kalite kontrolünden geçmedi; yayınlanmadı.",
      );
    source = candidates[q.source_index - 1];
    if (
      q.kind !== b.kind ||
      typeof q.question !== "string" ||
      typeof q.expected !== "string" ||
      typeof q.quote !== "string" ||
      !source.text.includes(q.quote)
    )
      throw new ApiError("INTERNAL_ERROR", "Soru kaynakla eşleşmedi.");
    if (
      !q.quote.trim() ||
      q.question.length > 3000 ||
      !Array.isArray(q.options) ||
      q.options.length > 4 ||
      q.options.some(
        (o: any) => typeof o !== "string" || !o.trim() || o.length > 400,
      ) ||
      (["MULTIPLE_CHOICE", "TRUE_FALSE"].includes(b.kind) &&
        (!/^[0-3]$/.test(q.expected) || Number(q.expected) >= q.options.length))
    )
      throw new ApiError("INTERNAL_ERROR", "Geçersiz soru biçimi.");
    await this.knowledge.source(u, c, source.material_id, source.id);
    const row = await this.prisma.learningQuiz.create({
      data: {
        id: randomUUID(),
        userId: u.id,
        courseId: c,
        topic: b.topic,
        kind: b.kind,
        materialId: source.material_id,
        segmentId: source.id,
        version: source.version,
        data: {
          ...q,
          source,
          scope: b.scope || { mode: b.material_id ? "active" : "course" },
          watched_only: Boolean(b.watched_only),
        },
      },
    });
    return this.publicQuiz(row);
  }
  private publicQuiz(row: any) {
    const d = row.data,
      s = d.source;
    // Never leak a complete source excerpt, answer key or option rationale before answering.
    return {
      id: row.id,
      topic: row.topic,
      kind: row.kind,
      question: d.question,
      options: d.options,
      objective: d.objective || null,
      note: d.note,
      experimental: d.experimental,
      assessment: d.assessment,
      scope: d.scope,
      watched_only: d.watched_only || false,
      quality_state:
        d.quality?.option_audit_version === 2
          ? "MODEL_REVIEWED_UNVERIFIED"
          : "LEGACY_NOT_REVIEWED",
      source: s
        ? {
            id: s.id,
            material_id: s.material_id,
            title: s.title,
            kind: s.kind,
            location: s.location,
          }
        : null,
    };
  }
  async quiz(u: AuthUser, c: string, id: string) {
    await this.access.requireMember(u, c);
    const q = await this.prisma.learningQuiz.findFirst({
      where: { id, userId: u.id, courseId: c, redacted: false },
    });
    if (!q) throw notFound("Quiz");
    await this.knowledge.source(u, c, q.materialId, q.segmentId);
    return this.publicQuiz(q);
  }
  async answer(u: AuthUser, c: string, id: string, response: string) {
    await this.quiz(u, c, id);
    const q = await this.prisma.learningQuiz.findUniqueOrThrow({
      where: { id },
    });
    const data = q.data as any;
    if (
      data.options?.length &&
      (!/^\d$/.test(response) || Number(response) >= data.options.length)
    )
      throw new ApiError(
        "VALIDATION_ERROR",
        "Geçerli bir yanıt seçeneği seçin.",
      );
    const norm = (s: string) =>
      s.trim().toLocaleLowerCase("tr").normalize("NFC");
    const reflection = q.kind === "OPEN",
      matched = norm(response) === norm(data.expected);
    const exact = ["MULTIPLE_CHOICE", "TRUE_FALSE", "CLOZE"].includes(q.kind);
    const score = reflection ? null : matched ? 1 : exact ? 0 : null;
    const outcome = reflection
      ? "REFLECTION_SAVED"
      : matched
        ? "CORRECT"
        : exact
          ? "REVIEW_SOURCE"
          : "REVIEW_REQUIRED";
    const feedback = {
      message: reflection
        ? "Yanıtın kaydedildi. Açık uçlu yanıt için otomatik doğruluk puanı verilmedi."
        : matched
          ? "Yanıt, bu sorunun kaynakla eşleştirilen cevap anahtarıyla uyumlu."
          : "Kaynak ifadesini incele; farklı sözcüklerle verilen kısa cevap otomatik yanlış sayılmaz.",
      expected: reflection
        ? null
        : data.options?.length
          ? data.options[Number(data.expected)]
          : data.expected,
      quote: data.quote,
      source: data.source,
      explanation: data.explanation || null,
      selected_option_feedback: data.options?.length
        ? data.option_feedback?.[Number(response)] || null
        : null,
      feedback_experimental: Boolean(data.experimental),
      mastery_estimated: false,
    };
    const row = await this.prisma.learningQuizAttempt.create({
      data: { quizId: id, userId: u.id, response, outcome, feedback, score },
    });
    return { id: row.id, outcome, score, ...feedback };
  }
  async quizzes(u: AuthUser, c: string) {
    await this.access.requireMember(u, c);
    return this.prisma.learningQuiz.findMany({
      where: { userId: u.id, courseId: c, redacted: false },
      select: {
        id: true,
        kind: true,
        topic: true,
        createdAt: true,
        attempts: {
          select: { outcome: true, score: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
}
