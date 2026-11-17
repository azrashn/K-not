// Öğretmenin ağzının açıklığı. Ses varsa çalan sesin şiddetinden (Web Audio AnalyserNode),
// ses yoksa konuşurken basit bir aç-kapa deseninden.

// Bu RMS'in altı sessizlik sayılır (nefes, kelime sonu).
export const SILENCE_RMS = 0.02
// Ağzın tam açıldığı RMS (konuşma tepeleri 0,2–0,3 civarı).
export const FULL_RMS = 0.22
// Sessiz desende bir hece.
export const FLAP_MS = 160

// Zaman örneklerinden (0..255, 128 = sessizlik) ağız açıklığı (0..1).
export function levelFromWaveform(samples) {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128
    sum += v * v
  }
  const rms = Math.sqrt(sum / samples.length)
  if (rms <= SILENCE_RMS) return 0
  return Math.min(1, (rms - SILENCE_RMS) / (FULL_RMS - SILENCE_RMS))
}

// Ses yokken zamana göre aç-kapa; mekanik görünmesin diye küçük farklarla.
export function flapAt(ms) {
  const n = Math.floor(ms / FLAP_MS)
  if (n % 2 === 1) return 0.05
  return n % 8 === 0 ? 0.9 : n % 4 === 2 ? 0.45 : 0.65
}

// Hızlı açılır, biraz yavaş kapanır (örnekler arasında titremez).
export function smoothMouth(current, target, dtMs) {
  const tau = target > current ? 40 : 90
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau)
  return current + (target - current) * k
}

// --- Ses ölçer (yalnızca tarayıcı) ---

let sharedContext = null
// Bir öğe Web Audio'ya yalnızca bir kez bağlanabilir; analizörü burada tutulur.
const analysers = new WeakMap()
const connecting = new WeakSet()

async function connect(element) {
  if (connecting.has(element) || typeof window === 'undefined') return
  const Ctor = window.AudioContext ?? window.webkitAudioContext
  if (!Ctor) return
  connecting.add(element)
  try {
    sharedContext ??= new Ctor()
    if (sharedContext.state !== 'running') await sharedContext.resume()
    if (sharedContext.state !== 'running' || analysers.has(element)) return
    const source = sharedContext.createMediaElementSource(element)
    const analyser = sharedContext.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.3
    source.connect(analyser)
    analyser.connect(sharedContext.destination)
    analysers.set(element, analyser)
  } catch {
    // Web Audio yok: aç-kapa deseni kullanılır.
  } finally {
    connecting.delete(element)
  }
}

// Bir ses öğesinin şiddetini ölçer. Ses bağlamı çalışana kadar (öğrencinin tıklaması gerekir)
// level() null döner ve aç-kapa deseni kullanılır.
export class AudioLevelMeter {
  element = null
  buffer = null

  watch(element) {
    if (element === this.element) return
    this.element = element
    if (element && !analysers.has(element)) void connect(element)
  }

  level() {
    const analyser = this.element ? analysers.get(this.element) : undefined
    if (!analyser || sharedContext?.state !== 'running') return null
    if (!this.buffer || this.buffer.length !== analyser.fftSize) this.buffer = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(this.buffer)
    return levelFromWaveform(this.buffer)
  }
}
