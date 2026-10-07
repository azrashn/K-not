// Geometri diyagramları: belge sayfalarındaki ağaç çizimleri.
const Node = ({ x, y, label, bf, tone = 'ink', r = 13 }) => (
  <g>
    <circle cx={x} cy={y} r={r} fill="#fff" stroke={tone === 'warn' ? '#a1362b' : '#383d49'} strokeWidth="1.2" />
    <text x={x} y={y + 3.6} textAnchor="middle" fontSize="10.5" fontFamily="JetBrains Mono, monospace" fill="#16181e">{label}</text>
    {bf !== undefined && (
      <text x={x + r + 3} y={y - r + 3} fontSize="8" fontFamily="JetBrains Mono, monospace" fill={tone === 'warn' ? '#a1362b' : '#5f6575'}>{bf}</text>
    )}
  </g>
)
const Edge = ({ x1, y1, x2, y2 }) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#383d49" strokeWidth="1.2" />

function Frame({ children, caption, vb = '0 0 300 132' }) {
  return (
    <figure className="m-0 mt-[3cqw] border border-line rounded-md bg-[#fbfaf6] px-[2cqw] py-[1.6cqw]">
      <svg viewBox={vb} className="block w-full h-auto" role="img" aria-label={caption}>{children}</svg>
      <figcaption className="font-mono text-ink-3 mt-[1cqw]" style={{ fontSize: 'max(9px, 1.9cqw)' }}>{caption}</figcaption>
    </figure>
  )
}

export function AvlDiagram() {
  return (
    <Frame caption="Şekil 4.2 · Dengeli AVL ağacı (köşede denge faktörü)">
      <Edge x1="150" y1="24" x2="90" y2="62" /><Edge x1="150" y1="24" x2="210" y2="62" />
      <Edge x1="90" y1="62" x2="60" y2="100" /><Edge x1="90" y1="62" x2="120" y2="100" />
      <Edge x1="210" y1="62" x2="180" y2="100" />
      <Node x={150} y={24} label="30" bf="0" />
      <Node x={90} y={62} label="20" bf="0" />
      <Node x={210} y={62} label="40" bf="1" />
      <Node x={60} y={100} label="10" bf="0" />
      <Node x={120} y={100} label="25" bf="0" />
      <Node x={180} y={100} label="35" bf="0" />
    </Frame>
  )
}

export function ChainDiagram() {
  return (
    <Frame caption="Şekil 4.1 · Sıralı eklemeyle oluşan zincir" vb="0 0 300 96">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          {i < 4 && <Edge x1={40 + i * 55} y1={22 + i * 12} x2={40 + (i + 1) * 55} y2={22 + (i + 1) * 12} />}
        </g>
      ))}
      {[10, 20, 30, 40, 50].map((v, i) => <Node key={v} x={40 + i * 55} y={22 + i * 12} label={v} r={12} />)}
    </Frame>
  )
}

export function LrDiagram() {
  return (
    <Frame caption="Şekil 4.5 · LR: önce sol çocukta sola, sonra kökte sağa döndürme" vb="0 0 320 112">
      {/* önce */}
      <Edge x1="70" y1="20" x2="40" y2="56" /><Edge x1="40" y1="56" x2="66" y2="92" />
      <Node x={70} y={20} label="30" bf="2" tone="warn" />
      <Node x={40} y={56} label="10" bf="-1" />
      <Node x={66} y={92} label="20" />
      {/* ok */}
      <path d="M118 56 H168" stroke="#2440a6" strokeWidth="1.4" fill="none" />
      <path d="M162 51 L169 56 L162 61" stroke="#2440a6" strokeWidth="1.4" fill="none" />
      {/* sonra */}
      <Edge x1="250" y1="26" x2="220" y2="68" /><Edge x1="250" y1="26" x2="280" y2="68" />
      <Node x={250} y={26} label="20" bf="0" />
      <Node x={220} y={68} label="10" />
      <Node x={280} y={68} label="30" />
    </Frame>
  )
}

export const DIAGRAMS = { avl: AvlDiagram, chain: ChainDiagram, lr: LrDiagram }
