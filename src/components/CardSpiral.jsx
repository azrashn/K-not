import { SPIRAL_LOOPS, spiralPaths, spiralViewBox } from '../lib/spiral'

// Üzerine gelinen defter kartının sol şeridinden taşan, el çizimi spiral tel. Süs olduğu için ekran
// okuyuculardan gizlenir. Renk kartın şerit rengidir (currentColor ← --spine); çizilme/silinme CSS'tedir.
const PATHS = spiralPaths()

export default function CardSpiral() {
  return (
    <svg className="card-spiral" viewBox={spiralViewBox()} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {PATHS.map((d, i) => (
        <path key={i} d={d} style={{ '--i': i, '--n': SPIRAL_LOOPS - 1 }} />
      ))}
    </svg>
  )
}
