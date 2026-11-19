import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createQueuePlayer, fetchSpeechUrl, loadLocalVoice } from '../lib/local-voice'
import { SPEECH_RATES, rankVoices, speechText, splitSpeech, textLanguage, voicePrefs } from '../lib/speech'

const fmt = (r) => `${String(r).replace('.', ',')}×`

/**
 * Yanıtı seslendirir. Biçimli metin önce düzyazıya çevrilir ve cümle cümle okunur.
 * İki ses motoru: (1) yerel sinirsel ses (Piper, çevrimdışı; kuruluysa varsayılan) ve (2) tarayıcının sesleri.
 * `autoPlay` ve tercih "ses açık" ise yeni yanıt kendiliğinden okunur; "Sesi kapat" dedikçe okunmaz.
 */
export default function Voice({ text, autoPlay = false, onAutoPlay }) {
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
      onAutoPlay?.()
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
        {import.meta.env.DEV && <span>Daha doğal yerel ses için: <code className="font-mono">npm run tts:install</code></span>}
      </p>
    )
  }

  const playLabel = state === 'playing' ? 'Duraklat' : state === 'paused' ? 'Devam et' : 'Dinle'
  const statusText = state === 'loading' ? 'Ses hazırlanıyor…'
    : state === 'blocked' ? 'Tarayıcı otomatik oynatmayı engelledi. Dinle\'ye bas.'
    : state === 'error' ? 'Seslendirme başarısız. Metni okuyabilirsin.'
    : ''

  return (
    <div className="voice-bar" role="group" aria-label="Sesli dinleme">
      <button
        type="button"
        className="tool-btn tool-btn--main"
        aria-label={playLabel === 'Dinle' ? 'Açıklamayı seslendir' : playLabel}
        onClick={() => {
          if (state === 'playing') pause()
          else if (state === 'paused') resume()
          else speak()
        }}
      >
        {state === 'playing' ? <span className="eq" aria-hidden><i /><i /><i /></span> : <Icon d="play" />}
        <span>{playLabel}</span>
      </button>
      <button type="button" className="tool-btn" aria-label="Durdur" title="Durdur" disabled={state === 'idle'} onClick={stop}>
        <Icon d="stop" />
      </button>
      <button type="button" className="tool-btn" aria-label="Baştan dinle" title="Baştan dinle" onClick={speak}>
        <Icon d="restart" />
      </button>
      <button
        type="button"
        className="tool-btn"
        aria-pressed={prefs.auto}
        aria-label={prefs.auto ? 'Otomatik okumayı kapat' : 'Otomatik okumayı aç'}
        title={prefs.auto ? 'Yeni yanıtlar otomatik okunur · kapat' : 'Otomatik okuma kapalı · aç'}
        onClick={() => { if (prefs.auto) stop(); voicePrefs.set({ auto: !prefs.auto }) }}
      >
        <Icon d={prefs.auto ? 'sound' : 'mute'} />
      </button>
      <details className="voice-settings">
        <summary className="tool-btn" aria-label="Ses ayarları" title="Ses ayarları"><Icon d="sliders" /></summary>
        <div className="voice-settings-panel">
          <label>
            <span>Hız</span>
            <select aria-label="Seslendirme hızı" value={prefs.rate} onChange={(e) => voicePrefs.set({ rate: Number(e.target.value) })}>
              {SPEECH_RATES.map((r) => <option key={r} value={r}>{fmt(r)}</option>)}
            </select>
          </label>
          {local.available && (
            <label>
              <span>Ses motoru</span>
              <select aria-label="Ses motoru" value={prefs.engine} onChange={(e) => { stop(); voicePrefs.set({ engine: e.target.value }) }}>
                <option value="auto">Yerel doğal ses (çevrimdışı)</option>
                <option value="browser">Tarayıcı sesi</option>
              </select>
            </label>
          )}
          {engine === 'browser' && ranked.length > 1 && (
            <label>
              <span>Ses</span>
              <select aria-label="Ses seçimi" value={voice?.voiceURI || ''} onChange={(e) => voicePrefs.set({ voiceURI: e.target.value })}>
                {ranked.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.localService ? '' : ' (çevrimiçi)'}</option>)}
              </select>
            </label>
          )}
          {engine === 'browser' && (
            <label className="voice-check">
              <input type="checkbox" checked={prefs.online} onChange={(e) => voicePrefs.set({ online: e.target.checked })} />
              <span>Daha doğal çevrimiçi sesleri de kullan</span>
            </label>
          )}
          {engine === 'browser' && prefs.online && <p>Çevrimiçi seslerde metin tarayıcının ses sağlayıcısına gidebilir.</p>}
          {engine === 'local' && <p>Metin bu bilgisayardan çıkmaz.</p>}
          {engine === 'browser' && !local.available && import.meta.env.DEV && <p>Daha doğal yerel ses için: <code className="font-mono">npm run tts:install</code></p>}
        </div>
      </details>
      {statusText && <small className="voice-status" role="status">{statusText}</small>}
    </div>
  )
}

const ICONS = {
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />,
  pause: <><rect x="4" y="3.5" width="3" height="9" rx="0.8" fill="currentColor" /><rect x="9" y="3.5" width="3" height="9" rx="0.8" fill="currentColor" /></>,
  stop: <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />,
  restart: <path d="M3 8a5 5 0 1 0 1.7-3.8M3 2.8v3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  sound: <><path d="M2.5 6.2h2.3L8 3.6v8.8L4.8 9.8H2.5z" fill="currentColor" /><path d="M10.5 5.6a3.3 3.3 0 0 1 0 4.8M12.2 3.9a5.7 5.7 0 0 1 0 8.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></>,
  mute: <><path d="M2.5 6.2h2.3L8 3.6v8.8L4.8 9.8H2.5z" fill="currentColor" /><path d="M10.5 6l3.5 4M14 6l-3.5 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>,
  sliders: <><path d="M2.5 5h11M2.5 11h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="6" cy="5" r="1.7" fill="var(--color-sheet)" stroke="currentColor" strokeWidth="1.4" /><circle cx="10.5" cy="11" r="1.7" fill="var(--color-sheet)" stroke="currentColor" strokeWidth="1.4" /></>,
}

function Icon({ d }) {
  return <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden focusable="false">{ICONS[d]}</svg>
}
