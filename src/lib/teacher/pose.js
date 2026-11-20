// Bir viewBox içinde çizilen figürün geometrisi: ekran → figür koordinatı ve bir noktaya uzanan
// iki parçalı kol (üst kol + ön kol). Açılar SVG rotate() derecesidir: 0 aşağı sarkan uzuv,
// pozitif sola (tahtaya doğru) döner, 90 yatay sola, 180 yukarı.

const DEG = 180 / Math.PI

function normalize(deg) {
  let d = deg % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a, k) => ({ x: a.x * k, y: a.y * k })

// Sarkan bir uzvu `v` yönüne çeviren rotate() açısı.
export const angleOf = (v) => Math.atan2(-v.x + 0, v.y) * DEG // + 0: yukarı 180 olsun, -180 değil

// `deg`, [min, max] aralığında; dışındaysa çemberde yakın olan sınır.
export function clampAngle(deg, min, max) {
  const d = normalize(deg)
  if (d >= min && d <= max) return d
  const gap = (bound) => Math.abs(normalize(d - bound))
  return gap(min) <= gap(max) ? min : max
}

export function directionOf(deg) {
  const r = deg / DEG
  return { x: -Math.sin(r), y: Math.cos(r) }
}

// Ekrandaki nokta, `rect` içinde gösterilen viewBox'ın (xMidYMid meet) koordinatında.
export function toViewBox(point, rect, view) {
  const k = Math.min(rect.width / view.w, rect.height / view.h) || 1
  const left = rect.left + (rect.width - view.w * k) / 2
  const top = rect.top + (rect.height - view.h * k) / 2
  return { x: (point.x - left) / k, y: (point.y - top) / k }
}

// Eli `target`'a götüren üst kol ve (üst kola göre) ön kol açıları. reach: hedef uzaksa kolun
// ne kadar gerileceği (1 = dümdüz). elbow: dirsek aşağı ("down") ya da sağa ("right") kırılır.
export function reachFor(shoulder, target, upperLen, lowerLen, { reach = 0.95, minAngle = -180, maxAngle = 180, elbow = 'down' } = {}) {
  const v = { x: target.x - shoulder.x, y: target.y - shoulder.y }
  const base = clampAngle(angleOf(v), minAngle, maxAngle)
  const longest = (upperLen + lowerLen) * Math.min(1, Math.max(0.2, reach))
  const shortest = Math.abs(upperLen - lowerLen) + 1e-3
  const d = Math.min(longest, Math.max(shortest, Math.hypot(v.x, v.y)))
  const cos = (upperLen * upperLen + d * d - lowerLen * lowerLen) / (2 * upperLen * d)
  const spread = Math.acos(Math.min(1, Math.max(-1, cos))) * DEG

  const hand = add(shoulder, scale(directionOf(base), d))
  const options = [base + spread, base - spread].map((upper) => {
    const at = add(shoulder, scale(directionOf(upper), upperLen))
    const lowerAbs = angleOf({ x: hand.x - at.x, y: hand.y - at.y })
    return { upper: normalize(upper), lower: normalize(lowerAbs - upper), at }
  })
  const key = (o) => (elbow === 'down' ? o.at.y : o.at.x)
  const best = key(options[0]) >= key(options[1]) ? options[0] : options[1]
  return { upper: best.upper, lower: best.lower }
}

export function handAt(shoulder, angles, upperLen, lowerLen) {
  const at = add(shoulder, scale(directionOf(angles.upper), upperLen))
  return add(at, scale(directionOf(angles.upper + angles.lower), lowerLen))
}

// `current`'ı `target`'a kare hızından bağımsız yaklaştırır (zaman sabiti tauMs).
export function approach(current, target, dtMs, tauMs) {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs)
  return current + (target - current) * k
}
