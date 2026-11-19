/** Reasons a v2 quiz question was not produced: stable codes from the ai-service (quiz_checks.py)
 *  plus a few the backend adds, each with the Turkish sentence shown to the user. */
import { ApiError, PublicErrorCode } from "../common/errors";

export const V2_PIPELINE = "single-call-v1";

export const FAILURE_MESSAGES: Record<string, string> = {
  // ai-service (quiz_checks.FAILURE_CODES)
  TIMEOUT: "Model soruyu ayrılan süre içinde yazamadı (zaman aşımı).",
  MODEL_UNREACHABLE: "Soru yazan yerel modele ulaşılamadı.",
  INVALID_JSON: "Modelin yanıtı okunabilir JSON değildi (bozuk ya da yarım kalmış yanıt).",
  SCHEMA_MISMATCH: "Modelin yanıtında gerekli alanlar eksik ya da yanlış türdeydi.",
  QUOTE_NOT_FOUND: "Modelin gösterdiği alıntı kaynakta birebir bulunamadı.",
  ANSWER_NOT_IN_OPTIONS: "Doğru cevap seçenekler arasında yoktu.",
  DUPLICATE_OPTIONS: "Seçeneklerin bazıları birbirinin aynısıydı.",
  ANSWER_LEAKED: "Soru kökü doğru cevabı ele veriyordu.",
  ANSWER_NOT_IN_SOURCE: "Doğru cevap alıntılanan kaynak cümlesine dayanmıyordu.",
  BAD_FORMAT: "Soru, türünün gerektirdiği biçime uymuyordu.",
  CALC_MISMATCH: "Hesaplama sorusunun cevabı, verilen işlemin sonucuyla uyuşmadı.",
  CALC_DATA_MISSING: "Hesaplama için gereken sayılar soruda verilmemişti.",
  DUPLICATE_STEM: "Soru, daha önce sorulmuş bir soruyla neredeyse aynıydı.",
  DUPLICATE_QUOTE: "Soru, başka bir sorunun dayandığı kaynak cümlesine dayanıyordu.",
  BUDGET_EXHAUSTED: "Yerel model için ayrılan süre bu soruya yetmedi.",
  TRUNCATED: "Modelin yanıtı izin verilen uzunluğa ulaştığı için yarıda kesildi.",
  NOT_SELF_CONTAINED: "Soru, görülmeyen bir önceki cümleye bağlı başlıyordu (ör. \"Bu\", \"Ardından\"); tek başına anlaşılmıyordu.",
  // backend
  NO_SOURCE: "Soru yazmaya uygun kaynak metni bulunamadı.",
  ENGINE_DISABLED: "Yapay zekâ servisinde yeni soru motoru kapalı (QUIZ_ENGINE=legacy).",
  INVALID_SHAPE: "Soru, sunucunun biçim ve kaynak kontrolünden geçmedi.",
  MISSING: "Yapay zekâ servisi bu soru için ne soru ne de neden döndürdü.",
  AI_ERROR: "Yapay zekâ servisi beklenmeyen bir hata döndürdü.",
};

export type QuizFailure = {
  slot: number;
  kind: string;
  variant?: string | null;
  code: string;
  reason: string;
  attempts: number;
};

/** The model service itself is the problem (as opposed to one question being bad). */
export const INFRASTRUCTURE_CODES = new Set(["MODEL_UNREACHABLE", "ENGINE_DISABLED"]);
export const TIME_CODES = new Set(["TIMEOUT", "BUDGET_EXHAUSTED"]);

export function failureMessage(code: string): string {
  return FAILURE_MESSAGES[code] ?? `Soru hazırlanamadı (${code}).`;
}

export function failure(slot: number, kind: string, code: string, attempts = 0, variant?: string | null): QuizFailure {
  return { slot, kind, variant: variant ?? null, code, reason: failureMessage(code), attempts };
}

/** One sentence for a person: the reason, and how many model attempts it took. */
export function describeFailure(f: QuizFailure): string {
  return f.attempts > 1 ? `${f.reason.replace(/\.$/, "")} (${f.attempts} deneme).` : f.reason;
}

function publicCode(code: string): PublicErrorCode {
  if (INFRASTRUCTURE_CODES.has(code)) return "AI_SERVICE_UNAVAILABLE";
  if (TIME_CODES.has(code)) return "PROVIDER_TIMEOUT";
  if (code === "NO_SOURCE") return "VALIDATION_ERROR";
  return "GENERATION_FAILED";
}

const ADVICE: Partial<Record<PublicErrorCode, string>> = {
  AI_SERVICE_UNAVAILABLE: "Biraz sonra yeniden deneyin.",
  PROVIDER_TIMEOUT: "Yeniden deneyin; sorun sürerse daha dar bir konu seçin.",
  GENERATION_FAILED: "Yeniden deneyin ya da konuyu tek bir kavrama daraltın.",
};

/** The error a single-question request (POST /quizzes) answers with. The public error codes are
 *  the ones the frontend already knows; the message now names the actual reason. */
export function quizError(failures: QuizFailure[]): ApiError {
  const first = failures[0] ?? failure(0, "", "MISSING");
  const code = publicCode(first.code);
  const advice = ADVICE[code];
  return new ApiError(
    code,
    `Soru hazırlanamadı: ${describeFailure(first)}${advice ? " " + advice : ""}`,
    { reasons: failures.map((f) => ({ code: f.code, kind: f.kind, attempts: f.attempts })) },
  );
}
