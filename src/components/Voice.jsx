import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createQueuePlayer, fetchSpeechUrl, loadLocalVoice } from '../lib/local-voice'
import { SPEECH_RATES, rankVoices, speechText, splitSpeech, textLanguage, voicePrefs } from '../lib/speech'

const fmt = (r) => `${String(r).replace('.', ',')}×`

/**
 * Yanıtı seslendirir. Biçimli metin önce düzyazıya çevrilir ve cümle cümle okunur.
 * İki ses motoru: (1) yerel sinirsel ses (Piper, çevrimdışı; kuruluysa varsayılan) ve (2) tarayıcının sesleri.
 * `autoPlay` ve tercih "ses açık" ise yeni yanıt kendiliğinden okunur; "Sesi kapat" dedikçe okunmaz.
 */
export default function Voice({ text, autoPlay = false }) {
  const prefs = useSyncExternalStore(voicePrefs.subscribe, voicePrefs.get)
  const [voices, setVoices] = useState([])
  const [local, setLocal] = useState({ available: false, languages: { tr: false, en: false } })
  const [localKnown, setLocalKnown] = useState(false)
  const [state, setState] = useState('idle') // idle | loading | playing | paused | error | blocked
  const run = useRef(0)
  const started = useRef(false)
  const timer = useRef(null)
  const player = useRef(null)
  const autoDone = useRef(false)
  const chunks = useMemo(() => splitSpeech(speechText(text)), [text])
  const ranked = useMemo(() => rankVoices(voices, { allowOnline: prefs.online }), [voices, prefs.online])
  const voice = ranked.find((v) => v.voiceURI === prefs.voiceURI) || ranked[0] || null
  // Türkçe metin Türkçe sesle, İngilizce metin İngilizce sesle okunur; o dilde yerel ses yoksa tarayıcı sesi.
  const lang = useMemo(() => textLanguage(text), [text])
  const engine = local.available && local.languages?.[lang] && prefs.engine !== 'browser' ? 'local' : voice ? 'browser' : null

  useEffect(() => {
    let alive = true
    loadLocalVoice().then((s) => { if (alive) { setLocal(s); setLocalKnown(true) } })
    const speech = window.speechSynthesis
    if (speech) {
      const refresh = () => setVoices(speech.getVoices())
      refresh()
      speech.addEventListener('voiceschanged', refresh)
      return () => {
        alive = false
        run.current += 1
        clearTimeout(timer.current)
        player.current?.stop(false)
        if (started.current) speech.cancel()
        speech.removeEventListener('voiceschanged', refresh)
      }
    }
    return () => { alive = false; player.current?.stop(false) }
  }, [])

  useEffect(() => { player.current?.setRate(prefs.rate) }, [prefs.rate])

  function halt() {
    run.current += 1
    clearTimeout(timer.current)
    player.current?.stop(false)
    player.current = null
    if (started.current && window.speechSynthesis) window.speechSynthesis.cancel()
  }

  function speakBrowser() {
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

  function speakLocal() {
    if (!chunks.length) return
    halt()
    const id = run.current
    const p = createQueuePlayer({
      chunks,
      rate: prefs.rate,
      fetchUrl: (chunk, signal) => fetchSpeechUrl(chunk, signal, lang),
      onState: (s) => {
        if (run.current !== id) return
        // Yerel ses çalışmazsa (model yüklenemedi vb.) tarayıcı sesine düş.
        if (s === 'error' && voice) { speakBrowser(); return }
        setState(s)
      },
    })
    player.current = p
    void p.play()
  }

  function speak() {
    if (engine === 'local') speakLocal()
    else if (engine === 'browser') speakBrowser()
  }

  function stop() {
    halt()
    setState('idle')
  }

  function pause() {
    if (player.current) player.current.pause()
    else window.speechSynthesis.pause()
    setState('paused')
  }
  function resume() {
    if (player.current) player.current.resume()
    else window.speechSynthesis.resume()
    setState('playing')
  }

  useEffect(() => {
    // Yerel ses durumu bilinmeden başlama: yoksa önce tarayıcı sesiyle başlayıp yerel sesi kaçırırdı.
    if (autoPlay && prefs.auto && localKnown && engine && !autoDone.current) {
      autoDone.current = true
      speak()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, prefs.auto, engine, localKnown])

  if (!localKnown) return null

  if (!engine) {
    return (
      <p className="text-xs text-ink-3">
        Yerel Türkçe ses bulunamadı. Yazılı açıklama kullanılabilir.
        {' '}
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={prefs.online} onChange={(e) => voicePrefs.set({ online: e.target.checked })} />
          Çevrimiçi Türkçe sesleri de dene
        </label>
        {' '}
        <span>Daha doğal yerel ses için: <code className="font-mono">npm run tts:install</code></span>
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button
        className="border border-hair px-3 py-2"
        onClick={() => {
          if (state === 'playing') pause()
          else if (state === 'paused') resume()
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
          : state === 'blocked' ? 'Tarayıcı otomatik oynatmayı engelledi. "Açıklamayı seslendir"e basın.'
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
          {local.available && (
            <label>
              Ses motoru{' '}
              <select aria-label="Ses motoru" value={prefs.engine} onChange={(e) => { stop(); voicePrefs.set({ engine: e.target.value }) }}>
                <option value="auto">Yerel doğal ses (çevrimdışı)</option>
                <option value="browser">Tarayıcı sesi</option>
              </select>
            </label>
          )}
          {engine === 'browser' && ranked.length > 1 && (
            <label>
              Ses{' '}
              <select aria-label="Ses seçimi" value={voice?.voiceURI || ''} onChange={(e) => voicePrefs.set({ voiceURI: e.target.value })}>
                {ranked.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.localService ? '' : ' (çevrimiçi)'}</option>)}
              </select>
            </label>
          )}
          {engine === 'browser' && (
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={prefs.online} onChange={(e) => voicePrefs.set({ online: e.target.checked })} />
              Daha doğal çevrimiçi sesleri de kullan
            </label>
          )}
          {engine === 'browser' && prefs.online && <span className="text-ink-3">Çevrimiçi seslerde metin tarayıcının ses sağlayıcısına gidebilir.</span>}
          {engine === 'local' && <span className="text-ink-3">Metin bu bilgisayardan çıkmaz.</span>}
          {engine === 'browser' && !local.available && <span className="text-ink-3">Daha doğal yerel ses için: <code className="font-mono">npm run tts:install</code></span>}
        </div>
      </details>
    </div>
  )
}
