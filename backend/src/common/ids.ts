import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Application-generated document ids (data-model.md: generated before insert, never reused).
 *  cuid-shaped: "c" + 24 base36 characters from a CSPRNG (~124 bits); matches the WBS-3
 *  Identifier pattern. Rejection sampling keeps the distribution uniform. */
export function newId(): string {
  let out = 'c';
  while (out.length < 25) {
    for (const b of randomBytes(32)) {
      if (b < 252 && out.length < 25) out += ALPHABET[b % 36];
    }
  }
  return out;
}
