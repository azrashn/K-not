/** A new exam from one or more past exams, written from the course sources (QUIZ_ENGINE=v2).
 *
 *  source pool → topics → question plan → saved row (GENERATING) → run in the background → result + note.
 *  Everything a request can be refused for (no document, no topic in the sources, nothing to plan) is decided
 *  before the row exists, so the student gets the reason at once instead of a failed exam. */
import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../common/errors";
import type { AuthUser } from "../../common/request-context";
import type { QuizTranscriptPolicy } from "../../config/config";
import type { KnowledgeService } from "../../knowledge/knowledge.service";
import type { PrismaService } from "../../prisma/prisma.service";
import { examStyleHint, type MergedExamProfile } from "../exam-style";
import type { QuizGenerator } from "../quiz-generator";
import { examItems, planQuestions } from "./question-plan";
import { RepeatGuard } from "./repeat-guard";
import { runInBackground, startNote } from "./set-runner";
import { loadPool, type SourcePool } from "./source-pool";
import { examTopics, rankParts, TOPIC_NOT_IN_DOCUMENTS, TOPIC_NOT_IN_SOURCES, type PlannedTopic } from "./topic-planner";

export { UNEXPECTED } from "./set-runner";
export const NOTHING_TO_ASK = "Ders kaynaklarında soru hazırlamaya uygun metin bulunamadı.";

export type ExamInput = {
  styleId: string;
  styleIds: string[];
  title: string;
  profile: MergedExamProfile;
  count: number;
  /** Topics the student wrote: used as written, each bound to the parts that hold it. */
  topics?: string[];
  scope?: any;
};

/** Topics the student wrote, as written and without repeats, each with the parts that are about it. */
export function writtenTopics(topics: string[] | undefined, pool: SourcePool): PlannedTopic[] | null {
  const seen = new Set<string>();
  const labels = (topics ?? [])
    .map((t) => String(t).trim().slice(0, 200))
    .filter((t) => t && !seen.has(t.toLocaleLowerCase("tr")) && seen.add(t.toLocaleLowerCase("tr")));
  if (!labels.length) return null;
  const bound = labels.map((label) => ({ label, parts: rankParts(label, pool.parts) })).filter((t) => t.parts.length);
  if (!bound.length) throw new ApiError("VALIDATION_ERROR", pool.transcriptsLeftOut ? TOPIC_NOT_IN_DOCUMENTS : TOPIC_NOT_IN_SOURCES);
  return bound;
}

export class ExamBuilder {
  private readonly log = new Logger(ExamBuilder.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly generator: Pick<QuizGenerator, "generate">,
    private readonly policy: QuizTranscriptPolicy = "documents_first",
  ) {}

  /** Plans the exam and saves it as GENERATING; the questions are written in the background. */
  async create(u: AuthUser, c: string, input: ExamInput) {
    const pool = await loadPool(this.knowledge, u, c, { scope: input.scope }, this.policy);
    const topics = writtenTopics(input.topics, pool) ?? examTopics(input.profile.topic_terms, pool, input.profile.term_exams);
    const plan = planQuestions(examItems(input.profile, input.count), topics);
    if (!plan.slots.length) throw new ApiError("VALIDATION_ERROR", NOTHING_TO_ASK);
    const row = await this.prisma.generatedExam.create({
      data: {
        id: randomUUID(),
        courseId: c,
        userId: u.id,
        purpose: "EXAM",
        styleId: input.styleId,
        styleIds: input.styleIds,
        title: input.title,
        status: "GENERATING",
        requested: plan.slots.length,
        topics: [...new Set(plan.slots.map((s) => s.topic))],
        items: [],
        failures: [],
        note: startNote(plan, pool),
      },
    });
    runInBackground(this.log, row.id, {
      prisma: this.prisma, id: row.id, plan, pool,
      run: {
        generator: this.generator, user: u, course: c, scope: input.scope,
        styleHint: examStyleHint(input.profile), guard: new RepeatGuard(), purpose: "EXAM",
      },
    });
    return row;
  }
}
