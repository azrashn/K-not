// Seslendirme yardımcıları: ekrandaki biçimli metni konuşulabilir düzyazıya çevirir, cümlelere böler,
// Türkçe sesleri kaliteye göre sıralar ve kullanıcının tercihlerini (örn. sesin açık/kapalı olması) saklar.

const RATES = [0.8, 0.9, 1, 1.1, 1.25]
export const SPEECH_RATES = RATES

/** Markdown/formül/kod/bağlantı işaretlerini sesli okunacak hale getirir. */
export function speechText(source) {
  let t = String(source ?? '')
  t = t.replace(/\r\n?/g, '\n')
  t = t.replace(/```[\s\S]*?```/g, '\nKod örneği ekranda gösteriliyor.\n')
  t = t.replace(/\$\$[\s\S]*?\$\$/g, ' formül ekranda gösteriliyor. ')
  t = t.replace(/\$[^$\n]{1,200}\$/g, ' formül ')
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  t = t.replace(/https?:\/\/\S+/g, 'bağlantı')
  t = t.replace(/`([^`\n]+)`/g, '$1')
  t = t.replace(/\[(?:S|K|Kaynak\s*)?\d{1,3}\]/gi, '')
  t = t.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, '$1.')
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
  t = t.replace(/^\s*>\s?/gm, '')
  t = t.replace(/^\s*[-*•·]\s+/gm, '')
  t = t.replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, '')
  t = t.replace(/\s*\|\s*/g, ', ')
  t = t.replace(/[✳✦★→←↗↘⇒]/g, ' ')
  t = t.replace(/\s*[–—]\s*/g, ', ')
  // Her satır/madde kendi içinde bir cümle olsun: sonda noktalama yoksa nokta ekle (doğal duraklama).
  t = t
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?…:;]$/.test(line) ? line : `${line}.`))
    .join('\n')
  return t.replace(/[ \t]+/g, ' ').replace(/,\s*,/g, ',').trim()
}

/** Cümlelere (en çok `max` karakter) böler. Tarayıcılar uzun tek konuşmayı yarıda kesebilir ve duraklatma
 *  cümle sınırında doğal olur. Çok kısa parçalar birleştirilir. */
export function splitSpeech(text, max = 220) {
  const sentences = String(text || '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const pieces = []
  for (const s of sentences) {
    if (s.length <= max) { pieces.push(s); continue }
    let rest = s
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf('; ', max), rest.lastIndexOf(' ', max))
      const at = cut > max * 0.4 ? cut + 1 : max
      pieces.push(rest.slice(0, at).trim())
      rest = rest.slice(at).trim()
    }
    if (rest) pieces.push(rest)
  }
  const out = []
  for (const p of pieces) {
    if (out.length && out[out.length - 1].length < 25 && out[out.length - 1].length + p.length + 1 <= max) out[out.length - 1] += ` ${p}`
    else out.push(p)
  }
  return out
}

const isTurkish = (v) => /^tr([-_]|$)/i.test(v.lang || '')
const NATURAL = /natural|neural|premium|enhanced|online/i

/** Türkçe sesleri en doğal olandan başlayarak sıralar. Çevrimiçi sesler (metin sağlayıcıya gidebilir)
 *  yalnızca `allowOnline` ile dahil edilir. */
export function rankVoices(voices, { allowOnline = false } = {}) {
  const score = (v) => (NATURAL.test(v.name || '') ? 4 : 0) + (v.localService ? 1 : 0) + (v.default ? 0.5 : 0)
  return (voices || [])
    .filter((v) => isTurkish(v) && (allowOnline || v.localService))
    .map((v, i) => ({ v, i, s: score(v) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.v)
}

const KEY = 'knot.voice.prefs'
const DEFAULTS = { auto: true, rate: 1, voiceURI: '', online: false, engine: 'auto' }

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
    return {
      auto: raw.auto !== false,
      rate: RATES.includes(raw.rate) ? raw.rate : DEFAULTS.rate,
      voiceURI: typeof raw.voiceURI === 'string' ? raw.voiceURI : '',
      online: raw.online === true,
      engine: raw.engine === 'browser' ? 'browser' : 'auto',
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let state = read()
const listeners = new Set()

/** Tarayıcıda saklanan seslendirme tercihleri. Varsayılan: ses açık (otomatik seslendirme). */
export const voicePrefs = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  set(patch) {
    state = { ...state, ...patch }
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* depolama kapalı olabilir */ }
    listeners.forEach((fn) => fn())
  },
  reload() { state = read(); listeners.forEach((fn) => fn()) },
}
