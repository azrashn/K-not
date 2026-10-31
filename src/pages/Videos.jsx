import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import { useApp } from '../app/store'
import { Btn, PageFrame } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { validateVideoFile, videoTime, videoErrorText as errorText } from '../lib/video'

const STATES = { pending: 'Sırada', queued: 'Sırada', fetching: 'Video okunuyor', sampling: 'Kareler çıkarılıyor',
  embedding: 'Ses ve görseller hazırlanıyor', indexed: 'Hazır', failed: 'İşlenemedi', skipped: 'Daha önce işlendi' }

function FrameImage({ courseId, videoId, index }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    const abort = new AbortController()
    let objectUrl
    api.videoFrame(courseId, videoId, index, abort.signal).then(blob => {
      if (!abort.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) }
    }).catch(() => {})
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [courseId, videoId, index])
  return url ? <img src={url} alt="Videodan kaynak karesi" className="aspect-video w-full object-contain" />
    : <span className="block aspect-video bg-ink/[0.04]" aria-label="Kare yükleniyor" />
}

export default function Videos({ courseId }) {
  const { navigate } = useApp()
  const [videos, setVideos] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [link, setLink] = useState('')
  const [importing, setImporting] = useState(false)
  const linkAbort = useRef(null)
  const [fileUrl, setFileUrl] = useState(null)
  const [mediaLoading, setMediaLoading] = useState(false)
  const [chunks, setChunks] = useState([])
  const [frames, setFrames] = useState([])
  const [showAll, setShowAll] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)
  const [asking, setAsking] = useState(false)
  const [time, setTime] = useState(0)
  const input = useRef(null), player = useRef(null), askAbort = useRef(null)
  const active = videos.find(v => v.id === selected)
  useEffect(() => () => linkAbort.current?.abort(), [courseId])
  const ready = active?.status === 'indexed'
  const refresh = useCallback(async (signal) => {
    try {
      const result = await api.videos(courseId, signal)
      if (signal?.aborted) return
      setVideos(result.videos)
      setSelected(old => result.videos.some(v => v.id === old) ? old : result.videos[0]?.id ?? null)
      setLoadError('')
    } catch (e) { if (e.name !== 'AbortError') setLoadError(errorText(e)) }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [courseId])
  useEffect(() => {
    const controller = new AbortController()
    refresh(controller.signal)
    const timer = setInterval(() => refresh(controller.signal), 3000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [refresh])
  useEffect(() => {
    setAnswer(null); setChunks([]); setFrames([]); setFileUrl(null); setQuestion(''); setShowAll(false)
    askAbort.current?.abort(); setAsking(false)
    if (!ready) return
    const controller = new AbortController()
    let url
    setMediaLoading(true)
    Promise.all([api.videoTranscript(courseId, selected, controller.signal), api.videoFrames(courseId, selected, controller.signal)])
      .then(([t, f]) => { if (!controller.signal.aborted) { setChunks(t.chunks); setFrames(f.frames) } })
      .catch(e => { if (e.name !== 'AbortError') setError(errorText(e)) })
    api.videoFile(courseId, selected, controller.signal).then(blob => {
      if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setFileUrl(url) }
    }).catch(e => { if (e.name !== 'AbortError') setError(errorText(e)) })
      .finally(() => { if (!controller.signal.aborted) setMediaLoading(false) })
    return () => { controller.abort(); askAbort.current?.abort(); if (url) URL.revokeObjectURL(url) }
  }, [courseId, selected, ready])
  async function upload(file) {
    const invalid = validateVideoFile(file)
    if (invalid) { setError(invalid); return }
    setUploading(true); setError('')
    try { const row = await api.uploadVideo(courseId, file); setSelected(row.id); await refresh() }
    catch (e) { setError(errorText(e)) }
    finally { setUploading(false) }
  }
  async function ask(e) {
    e.preventDefault()
    if (!question.trim() || !ready || asking) return
    askAbort.current = new AbortController()
    setAsking(true); setError(''); setAnswer(null)
    try { const a = await api.videoAnswer(courseId, selected, question.trim(), askAbort.current.signal); setAnswer(a) }
    catch (e) { if (e.name !== 'AbortError') setError(errorText(e)) }
    finally { setAsking(false) }
  }
  async function importLink(e) {
    e.preventDefault()
    if (!link.trim() || importing || uploading) return
    linkAbort.current = new AbortController()
    setImporting(true); setError('')
    try {
      const row = await api.importVideoLink(courseId, link.trim(), linkAbort.current.signal)
      if (!linkAbort.current.signal.aborted) { setSelected(row.id); setLink(''); await refresh() }
    } catch (e) { if (e.name !== 'AbortError') setError(errorText(e)) }
    finally { setImporting(false) }
  }
  function seek(seconds) {
    if (player.current) {
      player.current.currentTime = seconds; setTime(seconds)
      player.current.scrollIntoView?.({ block: 'center', behavior: 'auto' })
    }
  }
  async function retry(id) {
    try { await api.retryVideo(courseId, id); await refresh() } catch (e) { setError(errorText(e)) }
  }
  return <PageFrame max="max-w-[90rem]">
    <MobileBar />
    <header className="border-b border-hair py-7">
      <button className="text-[13px] text-accent" onClick={() => navigate(`/dersler/${courseId}`)}>← Derse dön</button>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">Ders videoları</h1>
      <p className="mt-2 text-sm text-ink-2">Videonu yükle, anlatımda ara, kaynak anına dön. Bu videolar yalnızca sana açıktır.</p>
    </header>
    {(error || loadError) && <div role="alert" className="mt-4 border border-hair p-4 text-sm text-kopuk">{error || loadError} <button onClick={() => { setError(''); refresh() }} className="ml-3 underline">Yenile</button></div>}
    <div className="grid gap-6 py-6 xl:grid-cols-[16rem_minmax(0,1fr)]">
      <aside aria-label="Ders video listesi" className="min-w-0">
        <h2 className="mb-3 text-sm font-medium">Video ekle</h2>
        <Btn disabled={uploading || importing} onClick={() => input.current?.click()}>{uploading ? 'Video yükleniyor…' : 'Video yükle'}</Btn>
        <input ref={input} type="file" accept=".mp4,.webm,video/mp4,video/webm" className="sr-only" aria-label="Ders videosu seç"
          onChange={e => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = '' }} />
        <p className="my-3 text-xs text-ink-3">MP4 / WebM · en fazla 100 MB</p>
        <form onSubmit={importLink} className="mb-5 space-y-3 border border-hair p-3">
          <label htmlFor="video-link" className="block text-sm font-medium">YouTube veya Drive bağlantısı</label>
          <input id="video-link" type="url" required maxLength={2048} value={link} disabled={importing}
            onChange={e => setLink(e.target.value)} placeholder="https://…"
            aria-describedby="video-link-help" className="w-full min-w-0 border border-hair bg-paper px-2 py-2 text-sm" />
          <p id="video-link-help" className="text-xs leading-relaxed text-ink-3">YouTube videosu veya Drive dosya bağlantısı. Drive paylaşımı “Bağlantıya sahip herkes” olmalı. En fazla 100 MB / 2 saat.</p>
          <Btn type="submit" disabled={importing || uploading || !link.trim()}>{importing ? 'Video alınıyor…' : 'Bağlantıdan ekle'}</Btn>
          {importing && <p role="status" className="text-xs text-ink-2">Video indiriliyor; üç dakika kadar sürebilir. İşlem bitene kadar bu sayfayı açık tut.</p>}
        </form>
        {loading && <p role="status">Videolar yükleniyor…</p>}
        {!loading && !videos.length && <p className="text-sm text-ink-2">Henüz video yok. İlk ders videonu yükle.</p>}
        <ul className="space-y-2">
          {videos.map(v => <li key={v.id} className={`border p-3 ${selected === v.id ? 'border-accent' : 'border-hair'}`}>
            <button onClick={() => setSelected(v.id)} className="w-full text-left" aria-pressed={selected === v.id}>
              <span className="block break-words text-sm font-medium">{v.title}</span>
              <span className="mt-2 block font-mono text-xs text-ink-3">{STATES[v.status] || v.status} {v.frame_count > 0 ? `· ${v.frame_count} kare` : ''}</span>
            </button>
            {v.status === 'failed' && <button onClick={() => retry(v.id)} className="mt-2 text-sm text-accent">Yeniden dene</button>}
          </li>)}
        </ul>
      </aside>
      <main className="min-w-0 space-y-6">
        {active && !ready && <section role="status" className="border border-hair p-6">
          <h2 className="font-medium">{STATES[active.status] || 'Video hazırlanıyor'}</h2>
          <p className="mt-2 text-sm text-ink-2">Ses, zaman damgalı transkript ve kareler hazırlanıyor. Sayfayı kapatsan da işlem devam eder.</p>
          {active.progress != null && active.status !== 'failed' && <progress aria-label="Video işleme aşaması" max="1" value={active.progress} className="mt-4 w-full accent-accent" />}
        </section>}
        {ready && <>
          {active.transcript_note && <p role="status" className="border border-hair p-3 text-sm">{active.transcript_note}</p>}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="min-w-0 border border-hair p-3" aria-label="Video oynatıcı">
              {mediaLoading && <p role="status" className="p-4 text-sm">Video açılıyor…</p>}
              {fileUrl && <video ref={player} controls preload="metadata" src={fileUrl} className="aspect-video w-full bg-black"
                onTimeUpdate={e => setTime(e.currentTarget.currentTime)} aria-label="Ders videosu" />}
              <p className="mt-2 text-xs text-ink-3">Bir transkript satırına veya kareye tıklayarak ilgili zamana git.</p>
            </section>
            <section aria-label="Zaman damgalı transkript" className="max-h-[30rem] overflow-y-auto border border-hair">
              <h2 className="sticky top-0 border-b border-hair bg-paper p-3 text-sm font-medium">Transkript</h2>
              {!chunks.length && <p className="p-3 text-sm text-ink-3">Bu video için transkript bulunamadı.</p>}
              {chunks.map((c, i) => <button key={i} onClick={() => seek(c.start_seconds)}
                className={`block w-full border-b border-hair p-3 text-left hover:bg-ink/[0.04] ${time >= c.start_seconds && time < c.end_seconds ? 'bg-accent-tint' : ''}`}>
                <span className="font-mono text-xs text-accent">{videoTime(c.start_seconds)}</span>
                <span className="mt-1 block text-sm leading-relaxed">{c.text}</span>
              </button>)}
            </section>
          </div>
          <section aria-label="Videoya soru sor" className="border border-hair p-5">
            <h2 className="text-lg font-medium tracking-[-0.03em]">Bu videoya sor</h2>
            <p className="mt-2 text-xs text-ink-3">Deneysel yanıtlar hata içerebilir. Özellikle formülleri kaynak videodan kontrol et.</p>
            <form onSubmit={ask} className="mt-4 flex flex-wrap gap-3">
              <input aria-label="Video hakkında soru" value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)}
                placeholder="Bu bölümde ne anlatılıyor?" className="min-w-0 flex-1 border border-hair bg-paper px-3 py-2 text-sm" />
              <Btn type="submit" disabled={asking || !question.trim()}>{asking ? 'Kaynaklar inceleniyor…' : 'Sor'}</Btn>
            </form>
            {asking && <p role="status" className="mt-3 text-sm">İlgili transkript ve kareler aranıyor. Yanıt hazırlanıyor.</p>}
            {answer && <div aria-label="Video yanıtı" className="mt-5 space-y-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.answer}</p>
              <p className="text-xs text-ink-3">{answer.note}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {answer.citations.map(c => <button key={c.n} onClick={() => seek(c.timestamp_ms / 1000)} className="border border-hair p-3 text-left hover:border-accent">
                  <span className="font-mono text-xs text-accent">[{c.n}] {videoTime(c.timestamp_ms / 1000)}</span>
                  <span className="mt-1 line-clamp-3 block text-sm">{c.transcript || 'İlgili video karesi'}</span>
                </button>)}
              </div>
            </div>}
          </section>
          <section aria-label="Video kareleri">
            <h2 className="mb-3 text-lg font-medium">Kareler <span className="font-mono text-sm text-ink-3">{frames.length}</span></h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {(showAll ? frames : frames.slice(0, 12)).map(f => <button key={f.index} className="overflow-hidden border border-hair text-left hover:border-accent" onClick={() => seek(f.timestamp_ms / 1000)}>
                <FrameImage courseId={courseId} videoId={selected} index={f.index} />
                <span className="block p-2 font-mono text-xs">{videoTime(f.timestamp_ms / 1000)}</span>
              </button>)}
            </div>
            {frames.length > 12 && <button className="mt-3 text-sm text-accent" onClick={() => setShowAll(!showAll)}>{showAll ? 'Daha az göster' : 'Tüm kareleri göster'}</button>}
          </section>
        </>}
      </main>
    </div>
  </PageFrame>
}
