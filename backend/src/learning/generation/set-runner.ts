/** Runs a planned exam or quiz set in the background and keeps its GeneratedExam row up to date:
 *  produced questions, every failed try (with its code) and, at the end, the status and the note. */
import type { Logger } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";
import { generationNote } from "./generation-note";
import { runPlan, type RunOptions, type RunState } from "./generation-run";
import type { QuestionPlan } from "./question-plan";
import type { SourcePool } from "./source-pool";

export const UNEXPECTED = "Beklenmeyen bir hata oluştu.";

/** What the row says while the questions are being written: the transcript warning and a smaller plan. */
export function startNote(plan: QuestionPlan, pool: SourcePool): string | null {
  return generationNote({
    requested: plan.requested, planned: plan.slots.length, produced: plan.slots.length, unresolved: [], stopped: null,
    capacityNote: plan.note, warning: pool.warning,
  });
}

export async function runAndRecord(o: {
  prisma: PrismaService;
  id: string;
  plan: QuestionPlan;
  pool: SourcePool;
  run: Omit<RunOptions, "onProgress">;
}): Promise<void> {
  const first = startNote(o.plan, o.pool);
  let state: RunState = { produced: [], tries: [], stopped: null };
  const save = (status: string, note: string | null, finished = false) =>
    o.prisma.generatedExam.update({
      where: { id: o.id },
      data: {
        status,
        items: state.produced.map(({ quiz_id, kind, topic }) => ({ quiz_id, kind, topic })) as any,
        failures: state.tries.map(({ topic, kind, reason, code }) => ({ topic, kind, reason, code })) as any,
        note,
        ...(finished ? { finishedAt: new Date() } : {}),
      },
    });
  try {
    const result = await runPlan(o.plan, {
      ...o.run,
      onProgress: (s) => {
        state = s;
        return save("GENERATING", first);
      },
    });
    state = result;
    const produced = result.produced.length;
    const note = generationNote({
      requested: o.plan.requested, planned: result.planned, produced, unresolved: result.unresolved,
      stopped: result.stopped, capacityNote: o.plan.note, warning: o.pool.warning,
    });
    await save(produced === result.planned ? "READY" : produced ? "PARTIAL" : "FAILED", note, true);
  } catch (e) {
    await save(state.produced.length ? "PARTIAL" : "FAILED", UNEXPECTED, true).catch(() => undefined);
    throw e;
  }
}

/** Starts runAndRecord without waiting; an error is logged (the row already says it failed). */
export function runInBackground(log: Logger, id: string, args: Parameters<typeof runAndRecord>[0]): void {
  void runAndRecord(args).catch((e) => log.error(`generation ${id} failed: ${e?.message ?? e}`));
}
