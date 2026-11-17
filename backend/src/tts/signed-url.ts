/**
 * Signed, expiring audio URLs. `<audio>` cannot send an Authorization header, so the audio URL
 * itself is the permission: key (HMAC of the text in the ai-service, unguessable) + expiry +
 * HMAC-SHA256(TTS_URL_SECRET, key.exp). Valid for at most 24 h; the expiry is rounded down to
 * the hour so the same audio keeps the same URL for a while (the browser can cache it).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const AUDIO_URL_TTL_SECONDS = 24 * 3600;
export const AUDIO_KEY = /^[0-9a-f]{64}$/;
const SIG = /^[0-9a-f]{64}$/;

export function expiryFor(nowSeconds: number): number {
  return Math.floor((nowSeconds + AUDIO_URL_TTL_SECONDS) / 3600) * 3600;
}

export function signAudio(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret).update(`${key}.${exp}`).digest('hex');
}

/** True only for a well-formed key, an unexpired expiry within the TTL, and a matching signature. */
export function verifyAudio(secret: string, key: string, exp: unknown, sig: unknown, nowSeconds: number): boolean {
  if (!AUDIO_KEY.test(key) || typeof sig !== 'string' || !SIG.test(sig)) return false;
  const e = typeof exp === 'string' && /^\d{1,12}$/.test(exp) ? Number(exp) : NaN;
  if (!Number.isSafeInteger(e) || e < nowSeconds || e > nowSeconds + AUDIO_URL_TTL_SECONDS) return false;
  const expected = Buffer.from(signAudio(secret, key, e), 'hex');
  return timingSafeEqual(expected, Buffer.from(sig, 'hex'));
}

export function audioPath(prefix: string, secret: string, key: string, nowSeconds: number): string {
  const exp = expiryFor(nowSeconds);
  return `${prefix.replace(/\/+$/, '')}/tts/audio/${key}.wav?exp=${exp}&sig=${signAudio(secret, key, exp)}`;
}
