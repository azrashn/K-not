/** Upload limits that can be raised for real lecture files. Read once at startup from the environment;
 *  a value outside its safe range falls back to the default instead of failing silently large. */
const MIB = 1024 * 1024;

function envBytes(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** PPTX and plain text study files. Whole file is held in memory while it is read. */
export const STUDY_FILE_MAX_BYTES = envBytes('STUDY_FILE_MAX_BYTES', 20 * MIB, 1024, 50 * MIB);
/** MP4 / WebM lecture videos. The whole file is held in memory while it is read: raise with care. */
export const VIDEO_MAX_BYTES = envBytes('VIDEO_MAX_BYTES', 100 * MIB, MIB, 2048 * MIB);

export const mbText = (bytes: number) => `${Math.max(1, Math.round(bytes / MIB))} MB`;
