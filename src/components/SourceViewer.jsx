import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CaretLeft, CaretRight, FilePdf, X, ArrowBendDownLeft, Warning, ArrowUpRight, Quotes } from '@phosphor-icons/react'
import { api } from '../api/endpoints'
import { errorText } from '../api/messages'
import { useResource } from '../hooks/useApi'
import { pageRange, splitPage } from '../lib/answer'
import ClaimMark from './ClaimMark'
import { EASE_OUT } from '../lib/motion'

const arrowBtn =
  'press grid place-items-center size-7 rounded-md text-ink-2 hover:bg-ink/[0.06] disabled:opacity-30 disabled:hover:bg-transparent'

// Üst şerit: ETKİN İDDİA → ETKİN KAYNAK. Çalışma alanındaki satırla aynı numara ve aynı ton.
function ContextStrip({ active, evidence, reduce, onClose }) {
  const gap = !!active?.claim?.gap
  const partial = evidence?.strength === 'partial'
  const numbered = typeof active?.claim?.n === 'number'
  const tone = gap ? 'bg-kopuk-tint' : active ? 'bg-accent-tint' : 'bg-paper'
  const lab = gap ? 'text-kopuk' : 'text-accent'

  return (
    <div className={`relative shrink-0 px-5 pb-3.5 pt-4 transition-colors duration-200 ${tone}`} data-context>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Kaynak görüntüleyiciyi kapat" className={`${arrowBtn} absolute right-3 top-3`}>
          <X size={16} />
        </button>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${active?.turnId}:${active?.claim?.id}`}
          initial={{ opacity: 0, y: reduce ? 0 : 4 }}
          animate={{ opacity: 1, y: 0, transition: { duration: reduce ? 0.1 : 0.2, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          className="flex items-start gap-3 pr-8"
        >
          {!active ? (
            <p className="m-0 text-[13.5px] text-ink-3">Bir kaynak etiketine dokunduğunda ilgili sayfa ve kanıt burada açılır.</p>
          ) : (
            <>
              <span className="pt-0.5">
                {numbered || gap ? <ClaimMark n={gap ? '–' : active.claim.n} tone={gap ? 'kopuk' : 'accent'} /> : (
                  <span aria-hidden className="grid size-[22px] place-items-center rounded-full bg-accent/15 text-accent"><ArrowUpRight size={12} weight="bold" /></span>
                )}
              </span>
              <div className="min-w-0">
                <p className={`m-0 text-[12px] font-medium ${lab}`}>
                  {active.claim.tag || 'Seçili ifade'}
                  <span className="text-ink-3"> · {gap ? 'yeterli kanıt yok' : partial ? 'kısmen destekleyen kanıt' : evidence ? `kanıt ${evidence.label}` : 'kaynak'}</span>
                </p>
                <p className="m-0 mt-0.5 line-clamp-2 text-[14.5px] leading-snug text-ink" style={{ letterSpacing: '-0.008em' }}>{active.claim.text}</p>
                {partial && (
                  <p className="m-0 mt-2 flex gap-1.5 text-[12.5px] leading-snug text-gevesek">
                    <Warning size={14} weight="fill" className="mt-px shrink-0" aria-hidden />
                    <span>{evidence.note}</span>
                  </p>
                )}
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Çıkarılmış sayfa metni (pages.v1). Düzen yeniden üretilmez; yalnızca metin ve doğrulanmış alıntı vurgusu. */
export function PageSheet({ page, range, strength, pulse, slide }) {
  const [before, hit, after] = splitPage(page.text, range)
  return (
    <div className="mx-auto w-full max-w-[36rem] rounded-[3px] bg-sheet shadow-[0_1px_2px_rgba(22,24,30,0.08),0_12px_28px_-14px_rgba(22,24,30,0.28)]" data-page={page.page}>
      <article className={`whitespace-pre-wrap break-words px-7 py-6 text-ink-2 ${slide ? 'text-[14.5px] leading-[1.6]' : 'font-serif text-[15.5px] leading-[1.65]'}`} data-page-text>
        {before}
        {hit && <mark key={pulse} className="evidence" data-evidence-mark data-strength={strength === 'partial' ? 'partial' : 'full'}>{hit}</mark>}
        {after}
        {!page.text && <span className="italic text-ink-3">Bu sayfada okunabilir metin yok (görsel ya da boş sayfa).</span>}
      </article>
      <footer className="flex justify-end px-7 pb-4 font-mono text-[11px] text-ink-3 num">{page.page} / {page.page_count}</footer>
    </div>
  )
}

function pageWindow(cur, total, size = 5) {
  const half = Math.floor(size / 2)
  const lo = Math.max(1, Math.min(cur - half, total - size + 1))
  const hi = Math.min(total, lo + size - 1)
  const out = []
  for (let p = lo; p <= hi; p++) out.push(p)
  return out
}

export default function SourceViewer({ view, setView, active, evidence, pulse, sources = [], scan, onClose, onAddMaterial }) {
  const reduce = useReducedMotion()
  const scroller = useRef(null)
  const doc = view ? sources.find((s) => s.id === view.docId) ?? { id: view.docId, title: 'Belge', documentType: 'other' } : null
  const evidenceHere = !!(evidence && view && evidence.docId === view.docId && evidence.page != null)
  const onEvidencePage = evidenceHere && view.page >= evidence.page && view.page <= (evidence.pageEnd ?? evidence.page)
  const iv = view?.indexingVersion ?? (evidenceHere ? evidence.indexingVersion : undefined)
  const pageRes = useResource(
    (signal) => (view ? api.page(view.docId, view.page, iv, signal) : Promise.resolve(null)),
    [view?.docId, view?.page, iv],
  )
  const page = pageRes.data
  const range = onEvidencePage && page ? pageRange(evidence.highlight, page) : null
  const noEvidence = !!active?.claim?.gap && !view
  const total = page?.page_count ?? doc?.pageCount ?? view?.page ?? 1

  useEffect(() => {
    if (!range) return
    const t = setTimeout(() => {
      scroller.current?.querySelector('[data-evidence-mark]')?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
    }, 60)
    return () => clearTimeout(t)
  }, [range?.start, range?.end, pulse, view?.page, view?.docId])

  const go = (p) => setView({ ...view, page: p })
  const switchDoc = (id) => {
    if (view?.docId === id) return
    setView({ docId: id, page: evidence && evidence.docId === id ? evidence.page : 1 })
  }
  const key = view ? `${view.docId}:${view.page}` : 'none'

  return (
    <section className="flex h-full min-h-0 flex-col bg-desk" aria-label="Kaynak görüntüleyici" data-viewer>
      <ContextStrip active={active} evidence={evidence} reduce={reduce} onClose={onClose} />

      {noEvidence || !view ? (
        noEvidence
          ? <NoEvidence unsupported={!!active?.claim?.unsupported} scan={scan} reduce={reduce} onAddMaterial={onAddMaterial} />
          : <div className="flex flex-1 items-center justify-center px-8 text-center text-[14px] text-ink-3">Soru sorduğunda ya da bir materyali açtığında kaynak burada görünür.</div>
      ) : (
        <>
          <div className="shrink-0 bg-paper px-5 pb-2.5 pt-3">
            <div className="flex items-center gap-2">
              <FilePdf size={16} className="shrink-0 text-ink-3" aria-hidden />
              <p className="m-0 min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-ink" title={doc?.filename || doc?.title}>{doc?.filename || doc?.title}</p>
              {sources.length > 1 && (
                <div role="tablist" aria-label="Belge" className="flex max-w-[55%] gap-0.5 overflow-x-auto rounded-lg bg-ink/[0.05] p-0.5">
                  {sources.map((d) => {
                    const on = view.docId === d.id
                    return (
                      <button
                        key={d.id} role="tab" aria-selected={on} type="button" onClick={() => switchDoc(d.id)} title={d.title}
                        className={`press h-6 max-w-[9rem] truncate rounded-md px-2 text-[12px] font-medium ${on ? 'bg-white text-ink shadow-[0_1px_2px_rgba(22,24,30,0.1)]' : 'text-ink-3 hover:text-ink'}`}
                      >
                        {d.title}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1">
              <button type="button" className={arrowBtn} disabled={view.page <= 1} onClick={() => go(view.page - 1)} aria-label="Önceki sayfa"><CaretLeft size={14} /></button>
              <div className="flex flex-1 items-center justify-center gap-0.5" role="group" aria-label="Sayfalar">
                {pageWindow(view.page, total).map((p) => {
                  const cur = view.page === p
                  const ev = evidenceHere && p >= evidence.page && p <= (evidence.pageEnd ?? evidence.page)
                  return (
                    <button
                      key={p} type="button" onClick={() => go(p)} aria-label={`Sayfa ${p}`} aria-current={cur ? 'page' : undefined}
                      className={`press relative h-7 min-w-8 rounded-md px-1 font-mono text-[12px] num ${cur ? 'bg-ink font-semibold text-white' : 'text-ink-3 hover:bg-ink/[0.06] hover:text-ink'}`}
                    >
                      {p}
                      {ev && <span aria-hidden className={`absolute -top-px left-1/2 size-[5px] -translate-x-1/2 rounded-full ${cur ? 'bg-[#9db0f2]' : 'bg-accent'}`} />}
                    </button>
                  )
                })}
              </div>
              <button type="button" className={arrowBtn} disabled={view.page >= total} onClick={() => go(view.page + 1)} aria-label="Sonraki sayfa"><CaretRight size={14} /></button>
            </div>
            <p className="m-0 mt-1 text-center font-mono text-[11px] text-ink-3 num">sayfa {view.page} / {total}</p>
          </div>

          <div className="relative min-h-0 flex-1">
            <div ref={scroller} data-viewer-scroll className="scroll-quiet absolute inset-0 overflow-y-auto px-5 pb-16 pt-5">
              {onEvidencePage && !range && evidence.excerpt && (
                <div className="mx-auto mb-4 max-w-[36rem] rounded-xl bg-white px-4 py-3 shadow-[0_1px_2px_rgba(22,24,30,0.05)]" data-excerpt>
                  <p className="m-0 flex items-center gap-1.5 text-[12px] font-medium text-ink-3"><Quotes size={13} aria-hidden /> Kaynak alıntısı · sayfada işaretlenmedi (alıntı birebir doğrulanamadı)</p>
                  <p className="m-0 mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{evidence.excerpt}</p>
                </div>
              )}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: reduce ? 0.12 : 0.24, ease: EASE_OUT } }}
                  exit={{ opacity: 0, transition: { duration: reduce ? 0.08 : 0.11, ease: EASE_OUT } }}
                >
                  {pageRes.loading && <p className="m-0 py-10 text-center text-[13.5px] text-ink-3" role="status">Sayfa yükleniyor…</p>}
                  {pageRes.error && (
                    <p role="alert" className="m-0 py-10 text-center text-[14px] text-ink-2">
                      {pageRes.error.code === 'NOT_FOUND' ? 'Bu sayfa ya da belge artık mevcut değil (silinmiş olabilir).' : errorText(pageRes.error)}
                    </p>
                  )}
                  {page && !pageRes.loading && (
                    <PageSheet page={page} range={range} strength={evidence?.strength} pulse={pulse} slide={doc?.documentType === 'slide'} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {evidenceHere && !onEvidencePage && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  onClick={() => setView({ docId: evidence.docId, page: evidence.page, indexingVersion: evidence.indexingVersion })}
                  className="press absolute bottom-4 left-1/2 inline-flex h-9 -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium text-white shadow-[0_8px_20px_-8px_rgba(22,24,30,0.55)]"
                >
                  <ArrowBendDownLeft size={14} /> Kanıta dön <span className="font-mono text-white/70">{evidence.label}</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </section>
  )
}

// Kanıt yok: güven özelliği, hata değil. Panelin tamamı bu duruma ayrılır.
function NoEvidence({ unsupported, scan, reduce, onAddMaterial }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto bg-paper px-7 py-8" data-no-evidence>
      <motion.div
        initial={{ opacity: 0, y: reduce ? 0 : 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } }}
        className="mx-auto w-full max-w-[24rem]"
      >
        <svg width="148" height="44" viewBox="0 0 148 44" fill="none" aria-hidden className="mb-6 overflow-visible">
          <circle cx="8" cy="22" r="5" fill="var(--color-ink-3)" />
          <path d="M13 22h50" stroke="var(--color-ink-3)" strokeWidth="2" strokeLinecap="round" />
          <path d="M63 22l-6-6M63 22l-7 5M63 22l-5 9" stroke="var(--color-ink-3)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M82 22h3M92 22h3" stroke="var(--color-line-strong)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="140" cy="22" r="5" fill="var(--color-paper)" stroke="var(--color-line-strong)" strokeWidth="1.6" strokeDasharray="3 2.6" />
        </svg>
        <h2 className="display m-0 text-[30px] text-ink">{unsupported ? 'Bu iddia için yeterli kanıt yok.' : 'Bu soru için kaynak bulunamadı.'}</h2>
        <p className="m-0 mt-3 text-[15px] leading-relaxed text-ink-2">
          {unsupported
            ? `Hazır ${scan.count} materyalde bu iddiayı destekleyen yeterli bir bölüm yok. Bilgi doğru olabilir; ama kaynağı olmadığı için K-not onu kanıtlanmış saymaz.`
            : `Hazır ${scan.count} materyalde arama yapıldı; soruyu yanıtlayan bir bölüm bulunamadı. Bu yüzden cevap uydurulmadı.`}
        </p>
        {scan.groups && <p className="m-0 mt-4 font-mono text-[11.5px] leading-relaxed text-ink-3">Taranan: {scan.groups}</p>}
        {onAddMaterial && (
          <p className="m-0 mt-5 text-[13.5px] leading-relaxed text-ink-3">
            Bu konuyu kapsayan bir materyal eklersen yanıt doğrudan o sayfaya bağlanır.{' '}
            <button type="button" onClick={onAddMaterial} className="font-medium text-accent underline underline-offset-4 hover:text-accent-deep">Materyal ekle</button>
          </p>
        )}
      </motion.div>
    </div>
  )
}
