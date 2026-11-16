// Küçük, bağımlılıksız .env yardımcıları (Windows / macOS / Linux).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

/** KEY=value okur; satır içi ` # yorum` ve çevreleyen tırnakları atar. Yoksa null. */
export function getEnv(file, key) {
  if (!existsSync(file)) return null
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${key}=(.*)$`))
    if (m) return m[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')
  }
  return null
}

/** KEY=value satırını yerinde değiştirir, yoksa sona ekler. Dosya BOM'suz, LF yazılır. */
export function setEnv(file, key, value) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : []
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  let found = false
  const out = lines.map((line) => {
    if (new RegExp(`^\\s*${key}=`).test(line)) { found = true; return `${key}=${value}` }
    return line
  })
  if (!found) out.push(`${key}=${value}`)
  writeFileSync(file, out.join('\n') + '\n', 'utf8')
}

export const newSecret = (bytes = 24) => randomBytes(bytes).toString('base64url')

/** Örnek şablondaki yer tutucu mu? (boş, change-me, replace-me …) */
export const isPlaceholder = (v) => !v || /change-?me|replace-?me/i.test(v)
