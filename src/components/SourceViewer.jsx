import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CaretLeft, CaretRight, FilePdf, X, ArrowBendDownLeft, MagnifyingGlass, Warning } from '@phosphor-icons/react'
import { DOCS } from '../data/mock'
import DocPage from './DocPage'
import { EASE_OUT } from '../lib/motion'

const iconBtn =
  'press grid place-items-center size-8 rounded-lg border border-line bg-surface text-ink-2 hover:bg-white hover:border-line-strong disabled:opacity-35 disabled:hover:bg-surface disabled:hover:border-line'

export default function SourceViewer({ view, setView, active, evidence, pulse, nearest, onClose }) {
  const reduce = useReducedMotion()
  const scroller = useRef(null)
  const doc = view ? DOCS[view.doc] : null
  const atEvidence = !!(evidence && view && evidence.doc === view.doc && evidence.page === view.page)
  const shown = atEvidence ? evidence : null
  const [lo, hi] = doc ? doc.range : [1, 1]

  // Kanıt görünür alana gelsin (anlık kaydırma: ipliğin hedefi sabit kalır)
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => {
      const el = scroller.current?.querySelector('[data-evidence-mark]')
      el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
    }, 60)
    return () => clearTimeout(t)
  }, [shown, pulse, view?.page, view?.doc])

  const go = (page) => setView({ doc: view.doc, page })
  const switchDoc = (id) => {
    if (view?.doc === id) return
    const target = evidence && evidence.doc === id ? evidence.page : DOCS[id].range[0]
    setView({ doc: id, page: target })
  }

  const key = view ? `${view.doc}:${view.page}` : 'none'

  return (
    <section className="flex h-full min-h-0 flex-col bg-desk" aria-label="Kaynak görüntüleyici" data-viewer>
      <header className="bg-paper border-b border-line px-4 pt-3 pb-3">
        <div className="flex items-center gap-2 min-h-8">
          <FilePdf size={18} className="text-ink-3 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate font-mono text-[12.5px] font-medium text-ink" title={doc?.filename}>
              {doc ? doc.filename : 'Kaynak bulunamadı'}
            </p>
            <p className="m-0 truncate text-[12px] text-ink-3">{doc ? doc.label : 'Eşleşen belge yok'}</p>
          </div>
          {onClose && (
            <button type="button" className={iconBtn} onClick={onClose} aria-label="Kaynak görüntüleyiciyi kapat">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div role="tablist" aria-label="Belge" className="flex rounded-lg border border-line bg-surface p-0.5">
            {Object.values(DOCS).map((d) => {
              const on = view?.doc === d.id
              return (
                <button
                  key={d.id}
                  role="tab"
                  aria-selected={on}
                  type="button"
                  onClick={() => switchDoc(d.id)}
                  className={`press h-7 rounded-md px-2.5 text-[12.5px] font-medium ${on ? 'bg-ink text-white' : 'text-ink-3 hover:text-ink'}`}
                >
                  {d.short}
                </button>
              )
            })}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" className={iconBtn} disabled={!view || view.page <= lo} onClick={() => go(view.page - 1)} aria-label="Önceki sayfa">
              <CaretLeft size={15} />
            </button>
            <span className="min-w-[4.2rem] text-center font-mono text-[12.5px] text-ink num" aria-live="polite">
              {view ? <><span className="font-semibold">s.{view.page}</span><span className="text-ink-3"> / {doc.total}</span></> : '— / —'}
            </span>
            <button type="button" className={iconBtn} disabled={!view || view.page >= hi} onClick={() => go(view.page + 1)} aria-label="Sonraki sayfa">
              <CaretRight size={15} />
            </button>
          </div>
        </div>
      </header>

      <div ref={scroller} data-viewer-scroll className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={key}
            initial={{ opacity: 0, y: reduce ? 0 : 8, filter: reduce ? 'blur(0px)' : 'blur(2px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: reduce ? 0.12 : 0.24, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: reduce ? 0.08 : 0.11, ease: EASE_OUT } }}
          >
            {doc ? (
              <DocPage doc={doc} pageNo={view.page} evidence={shown} pulse={pulse} />
            ) : (
              <NoEvidence nearest={nearest} onOpen={() => nearest && setView({ doc: nearest.doc, page: nearest.page })} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <EvidenceCaption active={active} evidence={evidence} atEvidence={atEvidence} view={view} onReturn={() => evidence && setView({ doc: evidence.doc, page: evidence.page })} reduce={reduce} />
    </section>
  )
}

function NoEvidence({ nearest, onOpen }) {
  return (
    <div className="mx-auto mt-6 max-w-sm rounded-xl border border-dashed border-line-strong bg-surface/70 p-5">
      <span className="grid size-9 place-items-center rounded-lg border border-kopuk-line bg-kopuk-tint text-kopuk">
        <MagnifyingGlass size={18} />
      </span>
      <h3 className="mt-3 mb-1 text-[15px] font-semibold">Bu soru için kaynak yok</h3>
      <p className="m-0 text-[13.5px] leading-relaxed text-ink-2">
        14 materyal tarandı ve soruyu destekleyen bir bölüm bulunamadı. Gösterecek bir kanıt olmadığı için bu alan boş.
      </p>
      {nearest && (
        <button type="button" onClick={onOpen} className="press mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[12.5px] font-medium text-ink hover:border-line-strong">
          En yakın bölüme bak <span className="font-mono text-ink-3">{nearest.label}</span>
        </button>
      )}
    </div>
  )
}

function EvidenceCaption({ active, evidence, atEvidence, view, onReturn, reduce }) {
  const partial = evidence?.strength === 'partial'
  const gap = active?.claim?.gap
  const away = !!evidence && !atEvidence && !!view
  return (
    <footer className="border-t border-line bg-paper px-4 py-3 min-h-[76px]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${active?.turnId}:${active?.claim?.id}:${atEvidence}`}
          initial={{ opacity: 0, y: reduce ? 0 : 4 }}
          animate={{ opacity: 1, y: 0, transition: { duration: reduce ? 0.1 : 0.2, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
        >
          {!active ? (
            <p className="m-0 text-[13px] text-ink-3">Bir kaynak etiketine dokunduğunda ilgili sayfa ve kanıt burada açılır.</p>
          ) : (
            <>
              <p className="m-0 text-[12px] text-ink-3">{gap ? 'Seçili ifade' : partial ? 'Kısmen destekleyen kanıt' : 'Bu iddiayı destekleyen ifade vurgulandı'}</p>
              <p className="m-0 mt-0.5 line-clamp-2 text-[13.5px] font-medium leading-snug text-ink">{active.claim.text}</p>
              {partial && (
                <p className="m-0 mt-2 flex gap-1.5 rounded-md border border-gevesek-line bg-gevesek-tint px-2 py-1.5 text-[12.5px] leading-snug text-gevesek">
                  <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
                  <span>{evidence.note}</span>
                </p>
              )}
              {away && (
                <button type="button" onClick={onReturn} className="press mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-accent-line bg-accent-tint px-2 text-[12.5px] font-medium text-accent hover:border-accent">
                  <ArrowBendDownLeft size={13} /> Kanıta dön <span className="font-mono">{evidence.label}</span>
                </button>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </footer>
  )
}
