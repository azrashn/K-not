// Where the student left a quiz set or an exam, per course, for this browser tab (sessionStorage).
// The address (?set= / ?exam=) is the first source; this record only helps when the page is opened without
// one (from the side menu). Storage may be unavailable (private window, blocked): then nothing is remembered.

const key = (kind, course) => `knot.resume.${kind}.${course}`;
/** The record of the last set open in this tab, whatever the course ({ id, q, course }): the general quiz
 *  page (#/quiz) knows no course of its own. */
export const LAST = '_last';
const ID = /^[A-Za-z0-9_-]{1,80}$/;

/** { id, q, ... } for this course, or null. `q` is the 1-based question number. */
export function loadResume(kind, course) {
  if (!course) return null;
  try {
    const raw = window.sessionStorage.getItem(key(kind, course));
    const value = raw ? JSON.parse(raw) : null;
    if (!value || !ID.test(String(value.id || ''))) return null;
    return { ...value, q: Number.isInteger(value.q) && value.q >= 1 ? value.q : 1 };
  } catch {
    return null;
  }
}

export function saveResume(kind, course, value) {
  if (!course || !value?.id) return;
  try {
    window.sessionStorage.setItem(key(kind, course), JSON.stringify(value));
  } catch {
    /* not remembered: the address still holds it */
  }
}

export function clearResume(kind, course) {
  if (!course) return;
  try {
    window.sessionStorage.removeItem(key(kind, course));
  } catch {
    /* nothing to clear */
  }
}

/** The answers the server recorded (each question's `last_answer`), by question id. */
export function recordedResults(questions) {
  const out = {};
  for (const q of questions || []) if (q?.available !== false && q?.last_answer) out[q.id] = q.last_answer;
  return out;
}

/** Every question that can be solved has a recorded answer (and nothing is still being written). */
export function finished(item) {
  const questions = (item?.questions || []).filter((q) => q.available !== false);
  return item?.status !== 'GENERATING' && questions.length > 0 && questions.every((q) => q.last_answer);
}

/** A 1-based question number from the address or the record, as a position in `total` questions. */
export function positionOf(q, total) {
  const n = Number(q);
  if (!Number.isInteger(n) || n < 1 || !total) return 0;
  return Math.min(n, total) - 1;
}
