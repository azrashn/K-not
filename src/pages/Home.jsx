import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUp, FilePdf, ArrowRight } from '@phosphor-icons/react'
import { RECENT_MATERIALS, UNITS, topicState, STATE_TEXT } from '../data/academic'
import { useAuth } from '../app/auth'
import { SUGGESTIONS } from '../data/mock'
import { useApp } from '../app/store'
import { PageFrame, Btn, Section, TextLink } from '../components/ui'
import { MobileBar, SampleNotice } from '../components/PageBits'
import { KnotGlyph } from '../components/KnotStrength'
import { EASE_OUT } from '../lib/motion'

const greeting = () => {
  const h = new Date().getHours()
  return h < 5 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar'
}

export default function Home() {
  const reduce = useReducedMotion()
  const { navigate, topics, review, recentAnswered } = useApp()
  const { user } = useAuth()
  const firstName = (user?.display_name || '').trim().split(/\s+/)[0]
  const [q, setQ] = useState('')

  // Şimdi ne çalışmalıyım? → devam (AVL) + en çok tekrar gerektiren diğer ünite
  const scoreOf = (id) => topics.find((t) => t.id === id)?.score ?? 0
  const candidates = UNITS.filter((u) => u.id !== 'avl' && u.topics.some((id) => scoreOf(id) > 0))
    .map((u) => {
      const studied = u.topics.map((id) => topics.find((t) => t.id === id)).filter((t) => t.score > 0)
      const weakest = [...studied].sort((a, b) => a.score - b.score)[0]
      return { unit: u, weakest, mean: studied.reduce((a, t) => a + t.score, 0) / studied.length }
    })
    .filter((c) => topicState(c.weakest.score) !== 'tight')
    .sort((a, b) => a.weakest.score - b.weakest.score)
  const rec = candidates[0]

  const ask = (text) => navigate('/dersler/veri-yapilari/calisma', { question: text })
  const stagger = (i) => ({
    initial: { opacity: 0, y: reduce ? 0 : 8 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.32, delay: reduce ? 0 : 0.05 * i, ease: EASE_OUT } },
  })

  return (
    <PageFrame>
      <MobileBar />
      <SampleNotice>Bu özet ve öneriler henüz gerçek çalışma geçmişine bağlı değil. Dersler ve materyaller gerçektir.</SampleNotice>
      <header className="pb-10 pt-4 lg:pt-14">
        <motion.h1 {...stagger(0)} className="display m-0 text-[40px] text-ink sm:text-[52px]">
          {greeting()}{firstName ? `, ${firstName}` : ''}.
        </motion.h1>
        <motion.p {...stagger(1)} className="m-0 mt-3 max-w-[34rem] text-[17px] leading-relaxed text-ink-2">
          Veri Yapıları vizesine 6 gün var. Şimdi ne çalışmalı? Tek bir adım yeter.
        </motion.p>
      </header>

      <div className="grid gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {/* Tek ve belirgin sonraki eylem */}
          <motion.section {...stagger(2)} aria-label="Çalışmaya devam et">
            <h2 className="display m-0 text-[34px] text-ink sm:text-[40px]">AVL Ağaçları</h2>
            <p className="m-0 mt-2 text-[15px] text-ink-2">Veri Yapıları · dün 21:40 · son soru: “AVL ağaçlarında denge nasıl sağlanır?”</p>
            <div className="mt-5 flex items-center gap-4">
              <KnotGlyph state="SIKI" levels={[1, 1]} verified reduce={reduce} />
              <span className="text-[13px] text-ink-3"><span className="font-medium text-ink-2">Düğüm Gücü</span> <span className="font-mono font-semibold tracking-wide text-siki">SIKI</span> · 2/2 iddia destekleniyor</span>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Btn arrow className="group" onClick={() => navigate('/dersler/veri-yapilari/calisma')}>Çalışmaya devam et</Btn>
              <Btn variant="quiet" onClick={() => navigate('/dersler/veri-yapilari')}>Materyaller</Btn>
            </div>
          </motion.section>

          {rec && (
            <motion.section {...stagger(3)} className="mt-14" aria-label="Tekrar öneriliyor">
              <p className="m-0 text-[19px] font-medium leading-snug text-ink" style={{ letterSpacing: '-0.015em' }}>
                Tekrar öneriliyor: {rec.unit.name}
              </p>
              <p className="m-0 mt-1.5 max-w-[32rem] text-[15px] leading-relaxed text-ink-2">
                {rec.weakest.name} <span className="text-gevesek">{STATE_TEXT[topicState(rec.weakest.score)].toLocaleLowerCase('tr')}</span>; {rec.weakest.answered} sorudan {rec.weakest.correct}’ini doğru yanıtladın.
                {rec.weakest.cite && <> Kaynağı <span className="whitespace-nowrap font-mono text-[13px]">{rec.weakest.cite.label}</span>.</>}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Btn variant="soft" size="sm" onClick={() => navigate('/quiz', { topic: rec.weakest.id })}>3 soruyla tekrar et</Btn>
                <Btn variant="quiet" size="sm" onClick={() => navigate('/analitik', { topic: rec.weakest.id })}>Bilgi İpinde gör</Btn>
              </div>
            </motion.section>
          )}

          <motion.section {...stagger(4)} className="mt-14" aria-label="Son çalışma">
            <p className="m-0 text-[15px] text-ink-2">
              <span className="text-ink-3">Son çalışma</span>{' '}
              <span className="num font-medium text-ink">{recentAnswered} soru · {review.length} eksik konu</span>
              <span className="mx-2 text-ink-3" aria-hidden>·</span>
              <TextLink className="text-[14px]" onClick={() => navigate('/analitik')}>Eksikleri gör</TextLink>
            </p>
          </motion.section>

          <motion.section {...stagger(5)} className="mt-14" aria-label="Materyallerine sor">
            <p className="m-0 text-[12.5px] font-medium text-ink-3">Veri Yapıları materyallerine sor</p>
            <form
              onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q.trim()) }}
              className="mt-2.5 flex items-center gap-2 rounded-2xl bg-white py-1.5 pl-4 pr-1.5 shadow-[0_1px_2px_rgba(22,24,30,0.06),0_0_0_1px_rgba(22,24,30,0.07)] transition-shadow duration-150 focus-within:shadow-[0_0_0_2px_var(--color-accent),0_6px_20px_-10px_rgba(36,64,166,0.4)]"
            >
              <label htmlFor="home-ask" className="sr-only">Materyallerine bir soru sor</label>
              <input id="home-ask" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Örn. AVL’de LR rotasyonu ne zaman gerekir?" className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3" />
              <button type="submit" disabled={!q.trim()} aria-label="Soruyu gönder" className="press grid size-10 place-items-center rounded-xl bg-ink text-white hover:bg-accent disabled:bg-ink/10 disabled:text-ink-3"><ArrowUp size={18} weight="bold" /></button>
            </form>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="press h-8 rounded-lg bg-ink/[0.05] px-3 text-[13px] text-ink-2 hover:bg-ink/[0.09] hover:text-ink">{s}</button>
              ))}
            </div>
          </motion.section>
        </div>

        <aside className="min-w-0">
          <motion.div {...stagger(3)}>
            <Section title="Son çalışılanlar">
              <ul className="m-0 list-none p-0">
                {RECENT_MATERIALS.map((m, i) => (
                  <li key={m.name} className={i ? 'border-t border-hair' : ''}>
                    <button
                      type="button"
                      onClick={() => m.doc
                        ? navigate('/dersler/veri-yapilari/calisma', { open: { cite: { doc: m.doc, page: m.page, seg: '', label: `${m.doc === 'notes' ? 'Notlar' : 'Slayt'} · s.${m.page}` }, text: m.name, tag: 'Kaldığın yer' } })
                        : navigate('/dersler/algoritmalar')}
                      className="press group -mx-3 flex w-[calc(100%+1.5rem)] items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-ink/[0.035]"
                    >
                      <FilePdf size={18} className="shrink-0 text-ink-3" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12.5px] font-medium text-ink">{m.name}</span>
                        <span className="block text-[13px] text-ink-3">{m.course} · {m.where}</span>
                      </span>
                      <ArrowRight size={14} className="shrink-0 text-ink-3 opacity-0 transition-[transform,opacity] duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          </motion.div>
        </aside>
      </div>
    </PageFrame>
  )
}
