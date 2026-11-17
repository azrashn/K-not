import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/request-context";
import { ApiError, notFound } from "../common/errors";
import { AccessService } from "../courses/access.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { LearningService } from "./learning.service";
import { commonReason, groundTopics } from "./exam-plan";
import { loadSourceTexts } from "./source-texts";
import {
  GradedItem, PRACTICE_MAX, PRACTICE_MIN, Slot, hasCodeMarkers, isDuplicateStem, planPractice, summarizePractice,
} from "./practice-plan";

type Item = { quiz_id: string; index: number; topic: string; kind: string; difficulty: string; focus: string };
type Failure = { topic: string; kind: string; reason: string };
type Task = { slot: Slot; topic: string; tries: number };

// Model or service trouble stops the whole run; a missing source only retries elsewhere.
const INFRASTRUCTURE = new Set(["AI_SERVICE_UNAVAILABLE", "PROVIDER_TIMEOUT"]);
const MAX_TRIES_PER_SLOT = 3;

/** A practice set: exactly N source-bound questions (5–25) prepared together, answered together.
 *  It is READY only when all N exist. Nothing is published short: a set that cannot be completed is FAILED. */
@Injectable()
export class PracticeService {
  private readonly log = new Logger(PracticeService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly learning: LearningService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async create(
    u: AuthUser,
    c: string,
    b: { count: number; topics?: string[]; title?: string; scope?: any; watched_only?: boolean; exam_style_id?: string },
  ) {
    await this.access.requireMember(u, c);
    if (!Number.isInteger(b.count) || b.count < PRACTICE_MIN || b.count > PRACTICE_MAX)
      throw new ApiError("VALIDATION_ERROR", `Soru sayısı ${PRACTICE_MIN} ile ${PRACTICE_MAX} arasında olmalı.`);
    if (b.exam_style_id) {
      const style = await this.prisma.examStyle.findFirst({ where: { id: b.exam_style_id, courseId: c, ownerId: u.id } });
      if (!style) throw notFound("Exam style");
    }
    const sources = await loadSourceTexts(this.knowledge, u, c, b.scope);
    const seen = new Set<string>();
    let topics = (b.topics ?? [])
      .map((t) => String(t).trim().slice(0, 200))
      .filter((t) => t && !seen.has(t.toLocaleLowerCase("tr")) && seen.add(t.toLocaleLowerCase("tr")))
      .slice(0, 12);
    if (!topics.length) topics = groundTopics([], sources, b.count).topics;
    if (!topics.length)
      throw new ApiError("VALIDATION_ERROR", "Konu bulunamadı. Bir veya birkaç konu yazın ya da kaynakların işlenmesini bekleyin.");
    const running = await this.prisma.generatedExam.count({
      where: { courseId: c, userId: u.id, status: "GENERATING", purpose: "PRACTICE" },
    });
    if (running) throw new ApiError("JOB_ALREADY_RUNNING", "Bu ders için bir alıştırma seti zaten hazırlanıyor. Bitmesini bekleyin.");
    const slots = planPractice(b.count, topics, hasCodeMarkers(sources.map((s) => s.text).join("\n")));
    const row = await this.prisma.generatedExam.create({
      data: {
        id: randomUUID(),
        courseId: c,
        userId: u.id,
        styleId: b.exam_style_id ?? null,
        purpose: "PRACTICE",
        title: (b.title?.trim() || `Alıştırma seti · ${slots.length} soru`).slice(0, 160),
        status: "GENERATING",
        requested: slots.length,
        topics,
        items: [],
        failures: [],
      },
    });
    void this.run(u, c, row.id, slots, topics, b).catch((e) => this.log.error(`practice ${row.id} failed: ${e?.message ?? e}`));
    return this.summary(row);
  }

  private async run(u: AuthUser, c: string, id: string, slots: Slot[], topics: string[], b: any) {
    const items: Item[] = [];
    const failures: Failure[] = [];
    const stems: string[] = [];
    const facts: string[] = [];
    let note: string | null = null;
    let attempts = 0;
    const maxAttempts = slots.length * MAX_TRIES_PER_SLOT + 5;
    const queue: Task[] = slots.map((slot) => ({ slot, topic: slot.topic, tries: 0 }));
    const save = (status: string, finished = false) =>
      this.prisma.generatedExam.update({
        where: { id },
        data: {
          status,
          items: [...items].sort((a, z) => a.index - z.index) as any,
          failures: failures as any,
          note,
          ...(finished ? { finishedAt: new Date() } : {}),
        },
      });
    try {
      while (queue.length && attempts < maxAttempts) {
        const task = queue.shift()!;
        const { slot } = task;
        attempts++;
        const retry = (reason: string) => {
          failures.push({ topic: task.topic, kind: slot.kind, reason: reason.slice(0, 300) });
          task.tries++;
          if (task.tries < MAX_TRIES_PER_SLOT)
            // A retry moves to the next topic: another source is more useful than the same refusal.
            queue.push({ ...task, topic: topics[(topics.indexOf(task.topic) + 1) % topics.length] });
        };
        try {
          const quiz: any = await this.learning.start(u, c, {
            topic: task.topic,
            kind: slot.kind,
            scope: b.scope,
            watched_only: Boolean(b.watched_only),
            ...(b.exam_style_id ? { exam_style_id: b.exam_style_id } : {}),
            difficulty: slot.difficulty,
            focus: slot.focus,
            avoid_focus_texts: facts.slice(-25),
            avoid_questions: stems.slice(-25),
          });
          if (isDuplicateStem(quiz.question, stems)) {
            await this.prisma.learningQuiz.deleteMany({ where: { id: quiz.id, userId: u.id } });
            retry("Aynı soru tekrar üretildi; farklı bir soru isteniyor.");
            continue;
          }
          const stored = await this.prisma.learningQuiz.findUnique({ where: { id: quiz.id }, select: { data: true } });
          const fact = (stored?.data as any)?.focus_text;
          if (typeof fact === "string" && fact) facts.push(fact);
          stems.push(quiz.question);
          items.push({ quiz_id: quiz.id, index: slot.index, topic: task.topic, kind: slot.kind, difficulty: slot.difficulty, focus: slot.focus });
          await save("GENERATING");
        } catch (e: any) {
          const code = e?.code as string | undefined;
          retry(String(e?.message ?? "Soru hazırlanamadı."));
          if (code && INFRASTRUCTURE.has(code)) {
            note = "Soru hazırlayan model yanıt vermediği için üretim durduruldu.";
            await save("FAILED", true);
            return;
          }
        }
      }
      if (items.length === slots.length) note = null;
      else {
        const top = commonReason(failures);
        note = `${slots.length} sorudan ${items.length}'i kaynaklara dayanarak hazırlanabildi; eksik set başlatılmaz.` +
          (top ? ` En sık neden: ${top.reason}` : "");
        note = note.slice(0, 300);
      }
      await save(items.length === slots.length ? "READY" : "FAILED", true);
    } catch (e: any) {
      note = "Beklenmeyen bir hata oluştu.";
      await save("FAILED", true).catch(() => undefined);
      throw e;
    }
  }

  private summary(row: any) {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      requested: row.requested,
      produced: (row.items as Item[]).length,
      topics: row.topics,
      failures: row.failures,
      note: row.note,
      submitted: Boolean(row.submittedAt),
      created_at: row.createdAt,
      finished_at: row.finishedAt,
    };
  }

  private async own(u: AuthUser, c: string, id: string) {
    await this.access.requireMember(u, c);
    const row = await this.prisma.generatedExam.findFirst({ where: { id, courseId: c, userId: u.id, purpose: "PRACTICE" } });
    if (!row) throw notFound("Quiz set");
    return row;
  }

  async list(u: AuthUser, c: string) {
    await this.access.requireMember(u, c);
    const rows = await this.prisma.generatedExam.findMany({
      where: { courseId: c, userId: u.id, purpose: "PRACTICE" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rows.map((r) => this.summary(r));
  }

  /** Questions as students see them: no answers, no quotes. The graded result is included once submitted. */
  async get(u: AuthUser, c: string, id: string) {
    const row = await this.own(u, c, id);
    const questions = [];
    for (const item of row.items as Item[]) {
      try {
        questions.push({ ...(await this.learning.quiz(u, c, item.quiz_id)), index: item.index, available: true });
      } catch {
        questions.push({ id: item.quiz_id, index: item.index, kind: item.kind, topic: item.topic, available: false });
      }
    }
    return { ...this.summary(row), questions, result: row.result ?? null };
  }

  /** Grades everything at once. Unanswered questions are reported as blank; they never create attempts. */
  async submit(u: AuthUser, c: string, id: string, answers: { quiz_id: string; response: string }[]) {
    const row = await this.own(u, c, id);
    if (row.status !== "READY") throw new ApiError("VALIDATION_ERROR", "Alıştırma seti henüz hazır değil.");
    const claim = await this.prisma.generatedExam.updateMany({ where: { id, submittedAt: null }, data: { submittedAt: new Date() } });
    if (!claim.count) throw new ApiError("ALREADY_SUBMITTED", "Bu alıştırma zaten tamamlandı.");
    try {
      const items = [...(row.items as Item[])].sort((a, z) => a.index - z.index);
      const given = new Map(answers.map((a) => [a.quiz_id, String(a.response ?? "").trim()]));
      const rows = await this.prisma.learningQuiz.findMany({ where: { id: { in: items.map((i) => i.quiz_id) }, userId: u.id } });
      const byId = new Map(rows.map((r) => [r.id, r.data as any]));
      const detail: any[] = [];
      const graded: GradedItem[] = [];
      for (const item of items) {
        const data = byId.get(item.quiz_id) ?? {};
        const response = given.get(item.quiz_id) ?? "";
        let correct = false;
        let outcome = "BLANK";
        if (response) {
          const r: any = await this.learning.answer(u, c, item.quiz_id, response);
          correct = r.score === 1;
          outcome = r.outcome;
        }
        const options: string[] = Array.isArray(data.options) ? data.options : [];
        const expected = Number(data.expected);
        graded.push({ topic: item.topic, difficulty: item.difficulty, focus: item.focus, answered: Boolean(response), correct });
        detail.push({
          index: item.index,
          quiz_id: item.quiz_id,
          topic: item.topic,
          kind: item.kind,
          difficulty: item.difficulty,
          focus: item.focus,
          question: data.question ?? null,
          response: response || null,
          answered: Boolean(response),
          correct,
          outcome,
          options: options.map((text, i) => ({
            index: i,
            text,
            correct: i === expected,
            chosen: response === String(i),
            feedback: data.option_feedback?.[i] ?? null,
          })),
          expected: options.length ? options[expected] ?? null : data.expected ?? null,
          explanation: data.explanation ?? null,
          objective: data.objective ?? null,
          quote: data.quote ?? null,
          source: data.source
            ? { id: data.source.id, material_id: data.source.material_id, title: data.source.title, kind: data.source.kind, location: data.source.location }
            : null,
        });
      }
      const result = { summary: summarizePractice(graded), items: detail, submitted_at: new Date().toISOString() };
      await this.prisma.generatedExam.update({ where: { id }, data: { result: result as any } });
      return result;
    } catch (e) {
      // Nothing was stored: let the student send the same answers again.
      await this.prisma.generatedExam.updateMany({ where: { id }, data: { submittedAt: null } }).catch(() => undefined);
      throw e;
    }
  }

  async remove(u: AuthUser, c: string, id: string) {
    await this.access.requireMember(u, c);
    const removed = await this.prisma.generatedExam.deleteMany({ where: { id, courseId: c, userId: u.id, purpose: "PRACTICE" } });
    if (!removed.count) throw notFound("Quiz set");
    return { deleted: true };
  }
}
