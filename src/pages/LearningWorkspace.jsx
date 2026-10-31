import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import { useApp } from '../app/store'
import { PageFrame, Btn } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { useVideoProgress } from '../hooks/useVideoProgress'
import { videoTime, videoErrorText } from '../lib/video'

const locationLabel = l => l.kind === 'video' ? `${videoTime(l.start_ms / 1000)}–${videoTime(l.end_ms / 1000)}`
  : l.kind === 'page' ? `Sayfa ${l.page}` : l.kind === 'slide' ? `Slayt ${l.slide}${l.section === 'speaker_notes' ? ' · konuşmacı notu' : ''}` : 'Metin'
const watchLabel = { WATCHED: 'İlgili aralık izlendi', PARTIALLY_WATCHED: 'İlgili aralık kısmen izlendi', UNWATCHED: 'İlgili aralık izlenmedi', UNKNOWN: 'İzleme kaydı bilinmiyor' }

function Voice({ text }) {
  const [voice, setVoice] = useState(null), [state, setState] = useState('idle')
  const utteranceRef = useRef(null), waiting = useRef(null)
  useEffect(() => {
    const speech = window.speechSynthesis
    if (!speech) return
    const refresh = () => setVoice(speech.getVoices().find(v => v.localService && v.lang.startsWith('tr')) || null)
    refresh(); speech.addEventListener('voiceschanged', refresh)
    return () => { clearTimeout(waiting.current); utteranceRef.current = null; speech.cancel(); speech.removeEventListener('voiceschanged', refresh) }
  }, [])
  function speak() {
    if (!voice) return
    const speech = window.speechSynthesis
    clearTimeout(waiting.current); utteranceRef.current = null; speech.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utteranceRef.current = utterance
    utterance.voice = voice; utterance.lang = voice.lang
    utterance.onstart = () => { if (utteranceRef.current === utterance) { clearTimeout(waiting.current); setState('playing') } }
    utterance.onend = () => { if (utteranceRef.current === utterance) { clearTimeout(waiting.current); utteranceRef.current = null; setState('idle') } }
    utterance.onerror = e => { if (utteranceRef.current === utterance) { clearTimeout(waiting.current); utteranceRef.current = null; setState(['canceled', 'interrupted'].includes(e.error) ? 'idle' : 'error') } }
    waiting.current = setTimeout(() => {
      if (utteranceRef.current === utterance) { utteranceRef.current = null; speech.cancel(); setState('error') }
    }, 12000)
    setState('loading'); speech.speak(utterance)
  }
  if (!voice) return <p className="text-xs text-ink-3">Yerel Türkçe ses bulunamadı. Yazılı açıklama kullanılabilir.</p>
  return <div className="flex flex-wrap items-center gap-3 text-xs">
    <button className="border border-hair px-3 py-2" onClick={() => {
      if (state === 'playing') { window.speechSynthesis.pause(); setState('paused') }
      else if (state === 'paused') { window.speechSynthesis.resume(); setState('playing') }
      else speak()
    }}>{state === 'playing' ? 'Seslendirmeyi duraklat' : state === 'paused' ? 'Seslendirmeye devam et' : 'Açıklamayı seslendir'}</button>
    <span>{state === 'loading' ? 'Ses hazırlanıyor…' : state === 'error' ? 'Seslendirme başarısız. Metni okuyabilirsin.' : 'Yerel Türkçe ses · görüntülenen metin'}</span>
  </div>
}

function Practice({ courseId, turn, openSource }) {
  const [practice, setPractice] = useState(null), [answer, setAnswer] = useState(''), [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function start() {
    setBusy(true); setError('')
    try { setPractice(await api.knowledgePractice(courseId, turn.conversation_id)); setResult(null); setAnswer('') }
    catch (e) { setError(videoErrorText(e)) } finally { setBusy(false) }
  }
  return <section className="space-y-2 border-t border-hair pt-3" aria-label="Kaynaklı hatırlama pratiği">
    {!practice ? <button disabled={busy} className="text-xs text-accent underline" onClick={start}>{busy ? 'Pratik hazırlanıyor…' : 'Bu kaynakla pratik yap'}</button>
      : <form className="space-y-2" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError('')
        try { setResult(await api.knowledgeGrade(courseId, practice.id, answer)) }
        catch (err) { setError(videoErrorText(err)) } finally { setBusy(false) }
      }}>
        <p className="whitespace-pre-wrap text-sm">{practice.prompt}</p>
        <label className="block text-xs">Eksik ifade<input value={answer} onChange={e => setAnswer(e.target.value)} maxLength={300} className="mt-1 w-full border border-hair bg-paper p-2 text-sm" /></label>
        <button disabled={busy || !answer.trim()} className="border border-hair px-3 py-2 text-xs" type="submit">Yanıtı kontrol et</button>
        {result && <div role="status" className="space-y-2 text-sm"><p>{result.feedback}</p><p>Kaynak ifadesi: <strong>{result.expected}</strong></p>
          <button type="button" className="text-xs text-accent underline" onClick={() => openSource(result.source)}>İlgili kaynağa dön</button></div>}
        <p className="text-xs text-ink-3">{practice.note}</p>
      </form>}
    {error && <p role="alert" className="text-xs text-kopuk">{error}</p>}
  </section>
}

export default function LearningWorkspace({ courseId }) {
  const { navigate } = useApp()
  const [course, setCourse] = useState(null), [materials, setMaterials] = useState([])
  const [selected, setSelected] = useState(null), [segments, setSegments] = useState([]), [source, setSource] = useState(null)
  const [url, setUrl] = useState(null), [question, setQuestion] = useState(''), [turns, setTurns] = useState([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true), [confirmDelete, setConfirmDelete] = useState(false)
  const input = useRef(null), player = useRef(null), activeRequest = useRef(null), previewRequest = useRef(null), pending = useRef(null)
  const videoId = selected?.kind === 'VIDEO' ? selected.source_id : null
  const watch = useVideoProgress(courseId, videoId, Boolean(videoId), player)
  const refresh = useCallback(async (signal) => {
    const [c, m] = await Promise.all([api.course(courseId, signal), api.knowledgeMaterials(courseId, signal)])
    if (!signal?.aborted) { setCourse(c); setMaterials(m.materials); setLoading(false) }
  }, [courseId])
  useEffect(() => {
    const abort = new AbortController()
    refresh(abort.signal).catch(e => { if (e.name !== 'AbortError') { setError(videoErrorText(e)); setLoading(false) } })
    return () => { abort.abort(); activeRequest.current?.abort(); previewRequest.current?.abort() }
  }, [courseId, refresh])
  useEffect(() => {
    if (!videoId) return
    const abort = new AbortController(); let objectUrl
    api.videoFile(courseId, videoId, abort.signal).then(blob => {
      if (!abort.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl({ id: videoId, value: objectUrl }) }
    }).catch(e => { if (e.name !== 'AbortError') setError(videoErrorText(e)) })
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [courseId, videoId])
  async function select(material, target) {
    previewRequest.current?.abort()
    const abort = new AbortController(); previewRequest.current = abort
    if (selected?.id !== material.id) setUrl(null)
    setSelected(material); setSegments([]); setSource(null); setError(''); setConfirmDelete(false)
    pending.current = target?.location?.start_ms ?? 0
    try {
      const result = await api.knowledgePreview(courseId, material.id, abort.signal)
      if (abort.signal.aborted) return
      setSegments(result.segments)
      const actual = target ? result.segments.find(s => s.id === target.id) : result.segments[0]
      if (target && !actual) { setError('Kaynak güncellenmiş veya kaldırılmış. Soruyu yeniden gönder.'); return }
      setSource(actual || null)
      if (material.kind === 'VIDEO' && player.current?.readyState >= 1 && url?.id === material.source_id) {
        player.current.currentTime = pending.current / 1000
      }
    } catch (e) { if (e.name !== 'AbortError') setError(videoErrorText(e)) }
  }
  async function openEvidence(e) {
    try {
      const actual = await api.knowledgeSource(courseId, e.material_id, e.id)
      const material = materials.find(m => m.id === e.material_id)
      if (!material) throw new Error('Material missing')
      await select(material, actual)
    } catch { setError('Bu kaynak kaldırılmış veya güncellenmiş olabilir. Soruyu yeniden gönder.'); await refresh() }
  }
  async function upload(file) {
    if (!file) return
    setUploading(true); setError('')
    try {
      if (/\.pdf$/i.test(file.name)) await api.upload(courseId, file, { documentType: 'notes' })
      else if (/\.(mp4|webm)$/i.test(file.name)) await api.uploadVideo(courseId, file)
      else await api.knowledgeUpload(courseId, file)
      await refresh()
    } catch (e) { setError(videoErrorText(e)) } finally { setUploading(false) }
  }
  async function ask(event, explainTurn) {
    event?.preventDefault()
    const text = explainTurn ? explainTurn.question : question.trim()
    if (!text || busy) return
    const abort = new AbortController(); activeRequest.current = abort
    setBusy(true); setError('')
    try {
      await watch.flushForQuestion()
      const previous = explainTurn || turns.at(-1)
      const answer = await api.knowledgeAnswer(courseId, { question: text,
        ...(selected ? { active_material_id: selected.id } : {}),
        ...(videoId && player.current ? { current_time_ms: Math.round(player.current.currentTime * 1000) } : {}),
        ...(previous ? { conversation_id: previous.conversation_id } : {}),
        ...(explainTurn ? { explain_now: true } : {}),
      }, abort.signal)
      if (!abort.signal.aborted) {
        setTurns(old => explainTurn ? old.map(t => t === explainTurn ? answer : t) : [...old.slice(-7), answer])
        if (!explainTurn) setQuestion('')
      }
    } catch (e) { if (e.name !== 'AbortError') setError(videoErrorText(e)) }
    finally { if (activeRequest.current === abort) setBusy(false) }
  }
  async function remove() {
    if (!selected) return
    setUploading(true)
    try {
      if (selected.kind === 'PDF') await api.remove(selected.source_id)
      else if (selected.kind === 'VIDEO') await api.removeVideo(courseId, selected.source_id)
      else await api.knowledgeRemove(courseId, selected.id)
      setSelected(null); setSource(null); setSegments([]); setConfirmDelete(false); setTurns([]); await refresh()
    } catch (e) { setError(videoErrorText(e)) } finally { setUploading(false) }
  }
  return <PageFrame max="max-w-[100rem]">
    <MobileBar />
    <header className="border-b border-hair py-6">
      <button className="text-sm text-accent" onClick={() => navigate(`/dersler/${courseId}`)}>← Derse dön</button>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">{course?.name || 'Ders çalışma alanı'}</h1>
      <p className="mt-2 text-sm text-ink-2">Tek ders, ortak kaynaklar. Video, PDF ve slaytları birlikte sorgula.</p>
    </header>
    {error && <p role="alert" className="my-4 border border-hair p-3 text-sm text-kopuk">{error}</p>}
    {loading && <p role="status" className="py-6">Ders kaynakları yükleniyor…</p>}
    <div className="grid min-w-0 gap-5 py-5 xl:grid-cols-[14rem_minmax(0,1fr)_minmax(20rem,25rem)]">
      <aside className="min-w-0 space-y-3" aria-label="Ortak ders materyalleri">
        <h2 className="text-sm font-semibold">Ders kaynakları <span className="font-mono text-xs">{materials.length}</span></h2>
        <Btn disabled={uploading} onClick={() => input.current?.click()}>{uploading ? 'Materyal ekleniyor…' : 'Materyal ekle'}</Btn>
        <input ref={input} type="file" className="sr-only" aria-label="Ortak ders materyali seç" accept=".pdf,.pptx,.txt,.mp4,.webm"
          onChange={e => { upload(e.target.files[0]); e.target.value = '' }} />
        <p className="text-xs leading-relaxed text-ink-3">PDF · PPTX / TXT (2 MB) · MP4 / WebM (100 MB)</p>
        <button className="text-xs text-accent underline" onClick={() => refresh().catch(e => setError(videoErrorText(e)))}>İşleme durumunu yenile</button>
        {!loading && !materials.length && <p className="text-sm text-ink-2">Başlamak için bir ders materyali ekle.</p>}
        {materials.map(m => <button key={m.id} disabled={m.status !== 'READY'} onClick={() => select(m)}
          className={`block w-full break-words border p-3 text-left ${m.id === selected?.id ? 'border-accent' : 'border-hair'} disabled:opacity-60`}>
          <span className="block text-sm font-medium">{m.title}</span>
          <span className="mt-2 block font-mono text-xs text-ink-3">{m.kind} · {m.status === 'READY' ? 'Hazır' : m.status}</span>
        </button>)}
      </aside>
      <section className="min-w-0 border border-hair p-4" aria-label="Ortak materyal görüntüleyici">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">{selected?.title || 'Materyal çalışma alanı'}</h2>
        {!selected && <p className="mt-4 text-sm leading-relaxed text-ink-2">Bir materyali veya cevaptaki kaynağı seç. Kaynaklar kendi sayfa, slayt ve zaman bilgileriyle açılır.</p>}
        {videoId && <div className="mt-4">
          {url?.id === videoId ? <video key={videoId} ref={player} src={url.value} controls className="aspect-video w-full bg-black" aria-label="Ortak ders videosu"
            onLoadedMetadata={e => { e.currentTarget.currentTime = (pending.current || 0) / 1000 }}
            onTimeUpdate={watch.observe} onPlay={watch.observe} onPlaying={watch.observe} onPause={watch.flush} onEnded={watch.flush}
            onSeeking={watch.reset} onSeeked={watch.seeked} onRateChange={watch.reset} onWaiting={watch.reset} /> : <p role="status">Video açılıyor…</p>}
          {watch.progress && <p className="mt-2 font-mono text-xs">İzlenen: %{watch.progress.watched_percent} · İzleme, öğrenme puanı değildir.</p>}
          {watch.error && <p role="alert" className="mt-2 text-xs text-kopuk">{watch.error}</p>}
        </div>}
        {source && <div className="mt-5 border-t border-hair pt-4">
          <p className="font-mono text-xs text-accent">{locationLabel(source.location)}</p>
          <p className="mt-2 text-xs text-ink-3">{selected?.kind === 'PPTX' ? 'Çıkarılan slayt metni · özgün slayt görünümü değildir' : selected?.kind === 'PDF' ? 'Gerçek sayfadan çıkarılan metin' : 'Kaynak metni'}</p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{source.text}</p>
        </div>}
        {segments.length > 1 && <div className="mt-5 max-h-72 space-y-2 overflow-y-auto border-t border-hair pt-3" aria-label="Materyal kaynak bölümleri">
          {segments.map(s => <button key={s.id} className={`block w-full border p-2 text-left text-sm ${s.id === source?.id ? 'border-accent' : 'border-hair'}`}
            onClick={() => { setSource(s); pending.current = s.location.start_ms || 0; if (player.current?.readyState >= 1) player.current.currentTime = pending.current / 1000 }}>
            <span className="font-mono text-xs text-accent">{locationLabel(s.location)}</span><span className="mt-1 line-clamp-2 block">{s.text}</span>
          </button>)}
        </div>}
        {selected && <div className="mt-5 flex flex-wrap gap-3 border-t border-hair pt-3 text-xs">
          {['PPTX', 'TXT'].includes(selected.kind) && <button className="text-accent underline" onClick={async () => {
            try { const blob = await api.knowledgeFile(courseId, selected.id); const u = URL.createObjectURL(blob); const a = document.createElement('a');
              a.href = u; a.download = selected.title; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60000)
            } catch (e) { setError(videoErrorText(e)) }
          }}>Özgün dosyayı indir</button>}
          {selected.kind === 'PDF' && <button className="text-accent underline" onClick={async () => {
            try { const blob = await api.file(selected.source_id); const u = URL.createObjectURL(blob); const a = document.createElement('a');
              a.href = u + '#page=' + (source?.location.page || 1); a.target = '_blank'; a.rel = 'noopener'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60000)
            } catch (e) { setError(videoErrorText(e)) }
          }}>Özgün PDF'yi aç</button>}
          {confirmDelete ? <><span>Materyal ve kaynakları kalıcı olarak kaldırılsın mı?</span><button disabled={uploading} onClick={remove} className="text-kopuk underline">Kalıcı olarak kaldır</button><button onClick={() => setConfirmDelete(false)}>Vazgeç</button></>
            : <button onClick={() => setConfirmDelete(true)} className="text-ink-3 underline">Materyali kaldır</button>}
        </div>}
      </section>
      <section className="min-w-0 space-y-4" aria-label="Ortak öğrenme asistanı">
        <h2 className="text-lg font-semibold tracking-[-0.03em]">Derse sor</h2>
        <p className="text-xs leading-relaxed text-ink-3">Soru, erişebildiğin hazır ders kaynaklarında aranır. Video izleme bilgisi diğer materyallere erişimini engellemez.</p>
        <form onSubmit={ask} className="space-y-3">
          <label htmlFor="unified-question" className="block text-sm">Ders kaynaklarına sorun</label>
          <textarea id="unified-question" value={question} maxLength={2000} rows={3} onChange={e => setQuestion(e.target.value)}
            placeholder="Videodaki örnekle slayttaki açıklamayı karşılaştır…" className="w-full resize-y border border-hair bg-paper p-3 text-sm" />
          <div className="flex flex-wrap items-center gap-3"><Btn type="submit" disabled={busy || !question.trim() || !materials.some(m => m.status === 'READY')}>{busy ? 'Kaynaklar değerlendiriliyor…' : 'Derse sor'}</Btn>
            {turns.length > 0 && <button type="button" disabled={busy} onClick={() => setTurns([])} className="text-xs text-accent underline">Yeni konuşma</button>}</div>
        </form>
        {turns.map((t, i) => <article key={i} className="space-y-3 border border-hair p-4" aria-label={`Ders yanıtı ${i + 1}`}>
          <h3 className="break-words text-sm font-semibold">{t.question}</h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{t.answer}</p>
          <p className="font-mono text-xs text-ink-3">{{ SOURCE_EXCERPTS: 'Gerçek kaynak alıntıları · model üretimi değil', GENERATED_UNVERIFIED: 'Deneysel model açıklaması · doğrulanmadı',
            GENERATION_FAILED_SOURCE_EXCERPTS: 'Model açıklaması tamamlanamadı; gerçek kaynak metinleri gösteriliyor', NO_EVIDENCE: 'Yeterli kaynak bulunamadı',
            INVALID_CITATIONS: 'Modelin kaynak numaraları doğrulanamadı', GUIDANCE: 'İlgili video bölümüne dön veya açıklama iste' }[t.status] || 'Kaynak durumu doğrulanamadı'}</p>
          {t.video_learning.map(l => {
            const evidence = t.evidence.find(e => e.id === l.source_id)
            return <p key={l.source_id} className="font-mono text-xs text-accent">{evidence ? `[${evidence.n}] ${locationLabel(evidence.location)} · ` : ''}{watchLabel[l.state]}</p>
          })}
          {t.status === 'GUIDANCE' && <Btn disabled={busy} onClick={() => ask(null, t)}>Şimdi açıkla</Btn>}
          {t.conflicts.map((c, n) => <p key={n} className="border border-hair p-2 text-xs text-kopuk">Olası kaynak uyuşmazlığı · kesinleştirilmedi. {c.message}</p>)}
          <div className="space-y-2" aria-label="Ortak yanıt kaynakları">{t.evidence.map(e => <button key={e.id} onClick={() => openEvidence(e)} className="block w-full border border-hair p-3 text-left hover:border-accent">
            <span className="font-mono text-xs text-accent">[{e.n}] {e.kind} · {locationLabel(e.location)}</span>
            <span className="mt-1 block break-words text-sm">{e.title}</span>
          </button>)}</div>
          {t.associations.length > 0 && <p className="text-xs text-ink-3">{t.associations.length} tahmini konu ilişkisi · ortak terimlere dayanır, kavramsal eşdeğerlik kanıtı değildir.</p>}
          {t.llm_used && <Voice key={`voice-${t.conversation_id}`} text={t.answer} />}
          {t.evidence.length > 0 && <Practice key={`practice-${t.conversation_id}`} courseId={courseId} turn={t} openSource={openEvidence} />}
          <p className="text-xs leading-relaxed text-ink-3">{t.note}</p>
        </article>)}
      </section>
    </div>
  </PageFrame>
}
