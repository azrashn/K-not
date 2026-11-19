// Defter teli: ders kartının sol şeridinden dışarı taşan, el çizimi hissi veren bir halka dizisi.
// Her halka ayrı bir yoldur (SVG path); yollar sabit tohumdan üretilir, yani her render'da ve her kartta
// aynı düzensizlik gelir (titreme yok). Koordinatlar 0..WIDTH x 0..(count*PITCH) viewBox'ındadır.

export const SPIRAL_WIDTH = 80
export const SPIRAL_PITCH = 40
export const SPIRAL_LOOPS = 9
// Kartın sol kenarı ile şerit bu x aralığındadır: halkalar soldan taşar, sağ uçları şeridin içinde biter.
export const SPIRAL_BAR_LEFT = 46
export const SPIRAL_BAR_RIGHT = 72

// Küçük, deterministik sözde-rastgele sayı üreteci (mulberry32): [0, 1)
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r = (n) => Math.round(n * 10) / 10

/** i. halkanın yolu: şeritten sola çıkan, sivri olmayan, hafif eğik ve düzensiz bir halka. */
export function loopPath(i, { pitch = SPIRAL_PITCH, left = 6, right = SPIRAL_BAR_RIGHT - 8 } = {}) {
  const rand = seeded(1013 + i * 7919)
  const j = (amount) => (rand() - 0.5) * 2 * amount
  const y = i * pitch + j(1.6)
  const h = pitch * (0.98 + rand() * 0.1)
  const xl = left + rand() * 9 // en soldaki nokta: her halka biraz farklı uzar
  const sx = right + j(2.5)
  const ex = right - 4 + j(3)
  const ty = y + h * (0.26 + rand() * 0.06) // sol ucun üst köşesi
  const by = y + h * (0.6 + rand() * 0.06) // sol ucun alt köşesi
  const start = [sx, y + 5 + j(1.5)]
  const top = [xl + 2 + j(2), ty]
  const bottom = [xl + j(2.5), by]
  const end = [ex, y + h * 0.99]
  return [
    `M${r(start[0])} ${r(start[1])}`,
    `C${r(sx - 12 + j(3))} ${r(y - 4 + j(2))} ${r(xl + 12 + j(3))} ${r(y - 2 + j(2))} ${r(top[0])} ${r(top[1])}`,
    `C${r(xl - 4 + j(2))} ${r(ty + (by - ty) * 0.3)} ${r(xl - 5 + j(2))} ${r(ty + (by - ty) * 0.7)} ${r(bottom[0])} ${r(bottom[1])}`,
    `C${r(xl + 16 + j(3))} ${r(y + h * 0.86 + j(2))} ${r(ex - 16 + j(3))} ${r(y + h + 2 + j(2))} ${r(end[0])} ${r(end[1])}`,
  ].join(' ')
}

export function spiralPaths(count = SPIRAL_LOOPS, opts) {
  return Array.from({ length: count }, (_, i) => loopPath(i, opts))
}

export const spiralViewBox = (count = SPIRAL_LOOPS, pitch = SPIRAL_PITCH) => `0 0 ${SPIRAL_WIDTH} ${count * pitch}`
