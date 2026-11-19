/** The note under a quiz set or exam: what was made, and in plain words why the rest was not.
 *  "14 sorudan 7'si hazırlandı. Hazırlanamayan 7 sorunun 7'sinde neden: … Her soru en fazla 2 kez denendi."
 *  Questions are counted, never attempts; the transcript warning and the capacity note come first. */
import { failureMessage } from "../quiz-failures";

/** The note column holds at most this many characters. */
export const NOTE_MAX = 300;

// Third-person possessive after a number, by how the number is read: 1'i (biri), 6'sı (altısı), 9'u (dokuzu)…
const ONES: Record<number, string> = { 1: "i", 2: "si", 3: "ü", 4: "ü", 5: "i", 6: "sı", 7: "si", 8: "i", 9: "u" };
const TENS: Record<number, string> = { 1: "u", 2: "si", 3: "u", 4: "ı", 5: "si", 6: "ı", 7: "i", 8: "i", 9: "ı" };

/** "7'si", "6'sı", "10'u", "100'ü", "0'ı". */
export function possessive(n: number): string {
  const suffix = n === 0 ? "ı" : n % 100 === 0 ? "ü" : n % 10 ? ONES[n % 10] : TENS[(n % 100) / 10];
  return `${n}'${suffix}`;
}

/** "7'sinde", "6'sında", "4'ünde": the possessive with the locative, by vowel harmony. */
export function possessiveIn(n: number): string {
  const word = possessive(n);
  return `${word}${/[ıuao]$/.test(word) ? "nda" : "nde"}`;
}

export type Unresolved = { code: string; tries: number };

export type NoteInput = {
  /** Questions the student asked for, and the questions the sources could be planned for. */
  requested: number;
  planned: number;
  produced: number;
  /** Planned questions that were not made: the reason of their last try and how many tries they had. */
  unresolved: Unresolved[];
  stopped: "MODEL" | "TIMEOUTS" | null;
  /** From the plan ("Kaynaklar yaklaşık N soruya yetiyor; M soru istendi.") and the pool (transcript). */
  capacityNote?: string | null;
  warning?: string | null;
};

/** The most common reason among the questions that were not made, with how many it applies to. */
export function commonReason(unresolved: Unresolved[]): { code: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const u of unresolved) counts.set(u.code, (counts.get(u.code) ?? 0) + 1);
  let best: { code: string; count: number } | null = null;
  for (const [code, count] of counts) if (!best || count > best.count) best = { code, count };
  return best;
}

export function generationNote(i: NoteInput): string | null {
  const sentences: string[] = [];
  if (i.warning) sentences.push(i.warning);
  if (i.capacityNote) sentences.push(i.capacityNote);
  if (i.stopped === "MODEL") sentences.push("Soru hazırlayan modele ulaşılamadığı için üretim durduruldu.");
  if (i.stopped === "TIMEOUTS") sentences.push("Model arka arkaya iki kez ayrılan sürede yanıt vermediği için üretim durduruldu.");
  if (i.produced < i.planned) {
    sentences.push(
      i.produced
        ? `${i.planned} sorudan ${possessive(i.produced)} hazırlandı.`
        : "Kaynaklara dayalı soru hazırlanamadı.",
    );
    const top = commonReason(i.unresolved);
    if (top && !i.stopped) {
      const missing = i.unresolved.length;
      const reason = failureMessage(top.code).replace(/\.$/, "");
      sentences.push(`Hazırlanamayan ${missing} sorunun ${possessiveIn(top.count)} neden: ${reason}.`);
      const most = Math.max(...i.unresolved.map((u) => u.tries));
      if (most > 1) sentences.push(`Her soru en fazla ${most} kez denendi.`);
    }
  }
  const note = sentences.join(" ");
  return note ? note.slice(0, NOTE_MAX) : null;
}
