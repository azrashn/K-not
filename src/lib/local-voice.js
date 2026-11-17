import { api } from '../api/endpoints'

// Yerel (çevrimdışı) sinirsel ses: metin sunucudan WAV olarak gelir, cümle cümle sıraya konup çalınır.
// Sıradaki cümle, çalan bitmeden hazırlanır; böylece cümleler arasında boşluk kalmaz.

let status = null
/** Yerel ses kurulu mu? Sonuç sayfa ömrü boyunca hatırlanır; hata/yanıt yoksa "yok" sayılır. */
export function loadLocalVoice() {
  if (!status) {
    status = Promise.resolve()
      .then(() => api.ttsStatus())
      .then((s) => ({ available: s?.available === true, voice: s?.voice || null }))
      .catch(() => ({ available: false, voice: null }))
  }
  return status
}
export function resetLocalVoice() { status = null }

function toBlobUrl(base64, mime) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/wav' }))
}

export async function fetchSpeechUrl(text, signal) {
  const r = await api.tts(text, signal)
  if (!r?.audio_base64) throw new Error('empty audio')
  return toBlobUrl(r.audio_base64, r.mime)
}

/**
 * Cümle sırasını çalar. onState: 'loading' | 'playing' | 'paused' | 'idle' | 'blocked' | 'error'.
 * `blocked`: tarayıcı kullanıcı etkileşimi olmadan sesi engelledi (otomatik oynatma).
 */
export function createQueuePlayer({ chunks, rate = 1, onState, fetchUrl = fetchSpeechUrl, makeAudio = (url) => new Audio(url), revoke = (url) => URL.revokeObjectURL(url) }) {
  let run = 0
  let ctl = null
  let audio = null
  let speed = rate
  let release = null

  async function play() {
    stop(false)
    const id = ++run
    ctl = new AbortController()
    const signal = ctl.signal
    const pending = new Map()
    const prefetch = (i) => {
      if (i < chunks.length && !pending.has(i)) {
        const p = fetchUrl(chunks[i], signal)
        p.catch(() => {}) // hata, sıra o cümleye geldiğinde ele alınır
        pending.set(i, p)
      }
    }
    onState('loading')
    try {
      for (let i = 0; i < chunks.length; i += 1) {
        prefetch(i)
        prefetch(i + 1)
        const url = await pending.get(i)
        if (run !== id) { revoke(url); return }
        await new Promise((resolve, reject) => {
          const a = makeAudio(url)
          audio = a
          release = resolve
          a.playbackRate = speed
          a.onplaying = () => { if (run === id) onState('playing') }
          a.onended = () => resolve()
          a.onerror = () => reject(new Error('playback failed'))
          Promise.resolve(a.play()).catch((e) => {
            if (e?.name === 'NotAllowedError') { const err = new Error('blocked'); err.blocked = true; reject(err) } else reject(e)
          })
        }).finally(() => { revoke(url); audio = null; release = null })
        if (run !== id) return
      }
      if (run === id) onState('idle')
    } catch (e) {
      if (run !== id || e?.name === 'AbortError') return
      onState(e?.blocked ? 'blocked' : 'error', e)
    }
  }

  function pause() { if (audio) { audio.pause(); onState('paused') } }
  function resume() { if (audio) { Promise.resolve(audio.play()).catch(() => onState('error')); onState('playing') } }
  function stop(notify = true) {
    run += 1
    ctl?.abort()
    if (audio) { try { audio.pause() } catch { /* zaten durmuş */ } audio = null }
    release?.() // çalan cümleyi bekleyen döngüyü serbest bırak (run sayacı değiştiği için orada durur)
    if (notify) onState('idle')
  }
  function setRate(r) { speed = r; if (audio) audio.playbackRate = r }
  return { play, pause, resume, stop, setRate }
}
