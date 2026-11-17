// El yazısı tahtasının geometrisi: verilen ilerlemede metnin ne kadarı yazılı, kalem ucu nerede,
// vurgu çizgileri nasıl. Ölçülmüş satır kutuları üzerinde saf fonksiyonlar (px, metin öğesine göre).

// Bir metnin istemci dikdörtgenleri, görsel satır başına tek kutuda birleştirilir (yukarıdan aşağı).
export function mergeLineRects(rects) {
  const lines = []
  const sorted = rects
    .filter((r) => r.right - r.left > 0.5 && r.bottom - r.top > 0.5)
    .sort((a, b) => a.top - b.top || a.left - b.left)
  for (const r of sorted) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top)
      return overlap > 0.5 * Math.min(l.bottom - l.top, r.bottom - r.top)
    })
    if (line) {
      line.left = Math.min(line.left, r.left)
      line.right = Math.max(line.right, r.right)
      line.top = Math.min(line.top, r.top)
      line.bottom = Math.max(line.bottom, r.bottom)
    } else lines.push({ ...r })
  }
  return lines
}

// El yazısı satır kutusunun dışına taşar.
const PAD = 12
const HIDDEN = 'inset(0 100% 100% 0)'
const round = (n) => Math.round(n * 10) / 10
const baseline = (line) => line.top + (line.bottom - line.top) * 0.78

// Metin soldan sağa, satır satır, sabit kalem hızıyla yazılır: toplam satır genişliğinin
// ilk `progress` (0..1) kadarı görünür. { clip, pen } döner; clip null ise her şey görünür.
export function revealAt(lines, progress) {
  if (progress >= 1 || lines.length === 0) return { clip: progress >= 1 ? null : HIDDEN, pen: null }
  if (progress <= 0) return { clip: HIDDEN, pen: { x: lines[0].left, y: baseline(lines[0]) } }

  const widths = lines.map((l) => l.right - l.left)
  let remaining = progress * widths.reduce((a, b) => a + b, 0)
  let i = 0
  while (i < lines.length - 1 && remaining > widths[i]) {
    remaining -= widths[i]
    i++
  }
  const line = lines[i]
  const x = line.left + Math.min(remaining, widths[i])
  const far = Math.max(...lines.map((l) => l.right)) + PAD
  const top = i === 0 ? -PAD : line.top
  // En fazla sonraki satırın üstüne kadar; sonraki satırdan hiçbir şey görünmez.
  const bottom = i < lines.length - 1 ? Math.min(line.bottom + PAD, lines[i + 1].top) : line.bottom + PAD
  const points = [[-PAD, -PAD], [far, -PAD], [far, top], [x, top], [x, bottom], [-PAD, bottom]]
  return {
    clip: `polygon(${points.map(([px, py]) => `${round(px)}px ${round(py)}px`).join(', ')})`,
    pen: { x, y: baseline(line) },
  }
}

// Çizgiler elle çizilmiş görünsün ama her çizimde zıplamasın diye sabit küçük sapma.
function wobble(seed) {
  const s = Math.sin(seed * 12.9898) * 43758.5453
  return s - Math.floor(s) - 0.5
}

// Adımın vurgusu notun ilk satırına bir kez çizilir. Çizgi listesi (her biri nokta dizisi) döner.
export function markStrokes(kind, allLines) {
  if (allLines.length === 0) return []
  const first = allLines[0]
  const { left, right, top, bottom } = first

  if (kind === 'underline') {
    const y = bottom - (bottom - top) * 0.08
    const stroke = []
    for (let k = 0; k <= 12; k++) {
      const t = k / 12
      stroke.push({ x: left - 4 + (right - left + 8) * t, y: y + Math.sin(t * Math.PI) * 2.5 - t * 2 + wobble(k) * 0.8 })
    }
    return [stroke]
  }

  if (kind === 'circle') {
    // Başladığı yeri biraz geçen bir elips.
    const cx = (left + right) / 2
    const cy = (top + bottom) / 2
    const rx = (right - left) / 2 + 16
    const ry = (bottom - top) / 2 + 10
    const stroke = []
    const n = 56
    const startAngle = -Math.PI * 0.62
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const a = startAngle + t * Math.PI * 2.12
      const grow = 1 + t * 0.05 + wobble(k) * 0.015
      stroke.push({ x: cx + Math.cos(a) * rx * grow, y: cy + Math.sin(a) * ry * grow })
    }
    return [stroke]
  }

  // Ok: sol boşluktan satır başına, sonra ucu.
  const tip = { x: left - 6, y: (top + bottom) / 2 }
  const tail = { x: tip.x - 34, y: tip.y + 16 }
  const shaft = []
  const n = 10
  for (let k = 0; k <= n; k++) {
    const t = k / n
    shaft.push({ x: tail.x + (tip.x - tail.x) * t, y: tail.y + (tip.y - tail.y) * t - Math.sin(t * Math.PI) * 6 })
  }
  const angle = Math.atan2(tip.y - shaft[n - 1].y, tip.x - shaft[n - 1].x)
  const head = (side) => [tip, { x: tip.x - Math.cos(angle + side * 0.5) * 11, y: tip.y - Math.sin(angle + side * 0.5) * 11 }]
  return [shaft, head(1), head(-1)]
}

export function strokeLength(stroke) {
  let len = 0
  for (let i = 1; i < stroke.length; i++) len += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y)
  return len
}

export const strokePath = (stroke) => stroke.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ')

function pointAlong(stroke, distance) {
  let left = distance
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1]
    const b = stroke[i]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    if (left <= d) {
      const t = d > 0 ? left / d : 0
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    left -= d
  }
  return stroke[stroke.length - 1]
}

// Çizgiler sabit hızla art arda çizilir: her çizginin kendi ilerlemesi ve kalem ucu.
export function drawStrokes(strokes, progress) {
  const lengths = strokes.map(strokeLength)
  const total = lengths.reduce((a, b) => a + b, 0)
  if (total === 0 || progress >= 1) return { each: strokes.map(() => (progress >= 1 ? 1 : 0)), pen: null }
  let remaining = Math.min(Math.max(progress, 0), 1) * total
  let pen = null
  const each = strokes.map((stroke, i) => {
    const len = lengths[i]
    if (remaining >= len) {
      remaining -= len
      return 1
    }
    if (remaining <= 0) return 0
    if (!pen) pen = pointAlong(stroke, remaining)
    const p = len > 0 ? remaining / len : 0
    remaining = 0
    return p
  })
  return { each, pen: progress > 0 && progress < 1 ? pen : null }
}
