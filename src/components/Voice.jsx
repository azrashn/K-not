import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { SPEECH_RATES, rankVoices, speechText, splitSpeech, voicePrefs } from '../lib/speech'

const fmt = (r) => `${String(r).replace('.', ',')}×`

/**
 * Yanıtı seslendirir. Biçimli metin önce düzyazıya çevrilir ve cümle cümle okunur (uzun konuşmalar yarıda
 * kesilmez, cümle aralarında doğal duraklama olur). `autoPlay` ve tercih "ses açık" ise yeni yanıt kendiliğinden
 * okunur; kullanıcı "Sesi kapat" dediği sürece okunmaz.
 */
export default function Voice({ text, autoPlay = false }) {
  const prefs = useSyncExternalStore(voicePrefs.subscribe, voicePrefs.get)
  const [voices, setVoices] = useState([])
  const [state, setState] = useState('idle') // idle | loading | playing | paused | error
  const run = useRef(0)
  const started = useRef(false)
  const timer = useRef(null)
  const autoDone = useRef(false)
  const chunks = useMemo(() => splitSpeech(speechText(text)), [text])
  const ranked = useMemo(() => rankVoices(voices, { allowOnline: prefs.online }), [voices, prefs.online])
  const voice = ranked.find((v) => v.voiceURI === prefs.voiceURI) || ranked[0] || null

  useEffect(() => {
    const speech = window.speechSynthesis
    if (!speech) return
    const refresh = () => setVoices(speech.getVoices())
    refresh()
    speech.addEventListener('voiceschanged', refresh)
    return () => {
      run.current += 1
      clearTimeout(timer.current)
      if (started.current) speech.cancel()
      speech.removeEventListener('voiceschanged', refresh)
    }
  }, [])

  function halt() {
    run.current += 1
    clearTimeout(timer.current)
    if (started.current) window.speechSynthesis.cancel()
  }

  function speak() {
    if (!voice || !chunks.length) return
    const speech = window.speechSynthesis
    halt()
    started.current = true
    const id = run.current
    let i = 0
    setState('loading')
    const next = () => {
      if (run.current !== id) return
      if (i >= chunks.length) { setState('idle'); return }
      const u = new SpeechSynthesisUtterance(chunks[i++])
      u.voice = voice
      u.lang = voice.lang
      u.rate = prefs.rate
      u.pitch = 1
      u.onstart = () => { if (run.current === id) { clearTimeout(timer.current); setState('playing') } }
      u.onend = () => { if (run.current === id) next() }
      u.onerror = (e) => {
        if (run.current !== id) return
        clearTimeout(timer.current)
        setState(['canceled', 'interrupted'].includes(e.error) ? 'idle' : 'error')
      }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (run.current === id) { run.current += 1; speech.cancel(); setState('error') }
      }, 12000)
      speech.speak(u)
    }
    next()
  }

  function stop() {
    halt()
    setState('idle')
  }

  useEffect(() => {
    if (autoPlay && prefs.auto && voice && !autoDone.current) {
      autoDone.current = true
      speak()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, prefs.auto, voice])

  if (!window.speechSynthesis || !ranked.length) {
    return (
      <p className="text-xs text-ink-3">
        Yerel Türkçe ses bulunamadı. Yazılı açıklama kullanılabilir.
        {' '}
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={prefs.online} onChange={(e) => voicePrefs.set({ online: e.target.checked })} />
          Çevrimiçi Türkçe sesleri de dene
        </label>
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button
        className="border border-hair px-3 py-2"
        onClick={() => {
          if (state === 'playing') { window.speechSynthesis.pause(); setState('paused') }
          else if (state === 'paused') { window.speechSynthesis.resume(); setState('playing') }
          else speak()
        }}
      >
        {state === 'playing' ? 'Seslendirmeyi duraklat' : state === 'paused' ? 'Seslendirmeye devam et' : 'Açıklamayı seslendir'}
      </button>
      <button className="product-link" disabled={state === 'idle'} onClick={stop}>Durdur</button>
      <button className="product-link" onClick={speak}>Baştan dinle</button>
      <button
        className="product-link"
        aria-pressed={prefs.auto}
        onClick={() => { if (prefs.auto) stop(); voicePrefs.set({ auto: !prefs.auto }) }}
      >
        {prefs.auto ? 'Sesi kapat' : 'Sesi aç'}
      </button>
      <span>
        {state === 'loading' ? 'Ses hazırlanıyor…'
          : state === 'error' ? 'Seslendirme başarısız. Metni okuyabilirsin.'
          : prefs.auto ? 'Yeni yanıtlar otomatik okunur' : 'Otomatik seslendirme kapalı'}
      </span>
      <details className="w-full">
        <summary className="cursor-pointer text-ink-2">Ses ayarları</summary>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label>
            Hız{' '}
            <select aria-label="Seslendirme hızı" value={prefs.rate} onChange={(e) => voicePrefs.set({ rate: Number(e.target.value) })}>
              {SPEECH_RATES.map((r) => <option key={r} value={r}>{fmt(r)}</option>)}
            </select>
          </label>
          {ranked.length > 1 && (
            <label>
              Ses{' '}
              <select aria-label="Ses seçimi" value={voice?.voiceURI || ''} onChange={(e) => voicePrefs.set({ voiceURI: e.target.value })}>
                {ranked.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.localService ? '' : ' (çevrimiçi)'}</option>)}
              </select>
            </label>
          )}
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={prefs.online} onChange={(e) => voicePrefs.set({ online: e.target.checked })} />
            Daha doğal çevrimiçi sesleri de kullan
          </label>
          {prefs.online && <span className="text-ink-3">Çevrimiçi seslerde metin tarayıcının ses sağlayıcısına gidebilir.</span>}
        </div>
      </details>
    </div>
  )
}
