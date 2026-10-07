import { DIAGRAMS } from './Diagrams'

// Kanıt parçasını işaretleyiciyle sarar. key=pulse: aynı kanıta tekrar tıklandığında süpürme yeniden oynar.
function Evidence({ evidence, pulse, children }) {
  return (
    <mark
      key={pulse}
      className="evidence"
      data-evidence-mark
      data-strength={evidence.strength}
    >
      {children}
    </mark>
  )
}

function Block({ block, evidence, pulse, serif }) {
  const hit = evidence && evidence.seg === block.id
  const content = hit ? <Evidence evidence={evidence} pulse={pulse}>{block.text}</Evidence> : block.text

  if (block.type === 'diagram') {
    const D = DIAGRAMS[block.name]
    return D ? <D /> : null
  }
  if (block.type === 'table') {
    return (
      <table className="w-full border-collapse mt-[2.4cqw] mb-[1.6cqw]" style={{ fontSize: serif ? '2.9cqw' : '2.5cqw' }}>
        <thead>
          <tr>{block.head.map((h) => <th key={h} className="text-left font-semibold text-ink border-b border-ink/70 py-[0.8cqw] pr-[2cqw]">{h}</th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((r) => (
            <tr key={r[0]}>{r.map((c, i) => <td key={i} className={`py-[0.9cqw] pr-[2cqw] border-b border-line ${i === 0 ? 'text-ink' : 'font-mono'}`}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (block.type === 'li') {
    return (
      <li className="relative pl-[3.2cqw] mb-[1.8cqw] list-none">
        <span aria-hidden className="absolute left-0 top-[1.15em] w-[1.1cqw] h-[1.1cqw] rounded-full bg-ink-3 -translate-y-1/2" />
        {content}
      </li>
    )
  }
  return <p className="mb-[2cqw] mt-0">{content}</p>
}

// Slayt: 16:10 yatay sayfa. Not: dikey, serif, kenar çizgili defter sayfası.
export default function DocPage({ doc, pageNo, evidence, pulse }) {
  const page = doc.pages[pageNo]
  if (!page) return null
  const slide = doc.kind === 'slide'

  const body = []
  let bucket = []
  const flush = (k) => {
    if (bucket.length) {
      body.push(<ul key={`ul-${k}`} className="m-0 p-0">{bucket}</ul>)
      bucket = []
    }
  }
  page.blocks.forEach((b, i) => {
    const el = <Block key={b.id} block={b} evidence={evidence} pulse={pulse} serif={!slide} />
    if (b.type === 'li') bucket.push(el)
    else { flush(i); body.push(el) }
  })
  flush('end')

  return (
    <div
      className="@container bg-sheet border border-line-strong/70 rounded-[3px] shadow-[0_1px_0_rgba(22,24,30,0.04),0_8px_24px_-12px_rgba(22,24,30,0.18)] mx-auto w-full"
      style={{ containerType: 'inline-size' }}
    >
      {slide ? (
        <article className="relative flex flex-col" style={{ minHeight: '62.5cqw' }}>
          <header className="flex items-center justify-between px-[4.2cqw] pt-[3cqw] text-ink-3 font-mono" style={{ fontSize: 'max(9px, 1.9cqw)' }}>
            <span>BIL 211 · Veri Yapıları</span>
            <span>Hafta 4</span>
          </header>
          <div className="px-[4.2cqw] pt-[2.6cqw] flex-1 text-ink-2" style={{ fontSize: '2.75cqw', lineHeight: 1.5 }}>
            <h3 className="m-0 mb-[2.6cqw] font-semibold text-ink" style={{ fontSize: '4.3cqw', lineHeight: 1.15 }}>{page.title}</h3>
            {body}
          </div>
          <footer className="mt-[3cqw] flex justify-between px-[4.2cqw] pb-[2.6cqw] text-ink-3 font-mono num" style={{ fontSize: 'max(9px, 1.9cqw)' }}>
            <span>Ankara Üniversitesi · Bilgisayar Müh.</span>
            <span>{pageNo}</span>
          </footer>
        </article>
      ) : (
        <article
          className="relative font-serif text-ink-2"
          style={{
            fontSize: '3.15cqw',
            lineHeight: 1.6,
            padding: '5cqw 6cqw 4cqw 9cqw',
            minHeight: '70cqw',
            backgroundImage: 'linear-gradient(to right, transparent calc(6.2cqw - 1px), rgba(161,54,43,0.28) calc(6.2cqw - 1px), rgba(161,54,43,0.28) 6.2cqw, transparent 6.2cqw)',
          }}
        >
          <div className="font-mono text-ink-3 mb-[3cqw]" style={{ fontSize: 'max(9px, 2cqw)' }}>VY · Ders Notları · 14 Ekim</div>
          <h3 className="m-0 mb-[3cqw] font-medium text-ink font-serif" style={{ fontSize: '4.6cqw', lineHeight: 1.2, letterSpacing: '-0.02em' }}>{page.title}</h3>
          {body}
          <div className="mt-[4cqw] text-right font-mono text-ink-3 num" style={{ fontSize: 'max(9px, 2cqw)' }}>{pageNo}</div>
        </article>
      )}
    </div>
  )
}
