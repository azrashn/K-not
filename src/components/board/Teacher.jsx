import { useEffect, useImperativeHandle, useRef } from 'react'
import { approach, reachFor, toViewBox } from '../../lib/teacher/pose'

// Sanal öğretmen: kodla çizilmiş, yetişkin oranlı düz illüstrasyon (uydurma bir figür).
// Tahtanın sağında durur, yüzü tahtaya dönük. Dışarıya yalnızca üç çağrı açar:
//   setState(state)   idle | thinking | talking | writing | pointing
//   aimAt(x, y)       elin gideceği / gösterdiği nokta (ekran koordinatı)
//   setMouthOpen(n)   0 kapalı … 1 açık
// Kendi kare döngüsünde SVG özniteliklerini doğrudan yazar; sayfa saniyede 60 kez çizilmez.

const VIEW = { w: 120, h: 228 }
const FRONT_SHOULDER = { x: 49, y: 68 } // tahtaya yakın kol
const BACK_SHOULDER = { x: 79, y: 68 }
const UPPER = 32
const LOWER = 31
const HEAD = { x: 64, y: 40 }
const CHIN = { x: 61, y: 53 } // düşünürken uzak el çeneye gider
const EYES = [{ x: 57.6, y: 40.2 }, { x: 64.4, y: 40.2 }]
const MOUTH = { x: 59, y: 47.6 }

const REST_FRONT = { upper: 4, lower: -2 }
const REST_BACK = { upper: -4, lower: 2 }
const THINK_BACK = reachFor(BACK_SHOULDER, CHIN, UPPER, LOWER, { reach: 1, elbow: 'down' })

const ARM_TAU_MS = 110
const BLINK_MS = 130
const EYE_OPEN = 1.3

const deg = (v) => v.toFixed(2)

// Omuzdan sarkan kol: üst kol, ön kol, manşet, el; isteğe bağlı kalem ve işaret parmağı.
function Arm({ at, upperRef, lowerRef, markerRef, fingerRef, far = false }) {
  const elbowY = at.y + UPPER
  const handY = elbowY + LOWER
  const sleeve = far ? 't-sleeve-far' : 't-sleeve'
  return (
    <g ref={upperRef}>
      <line x1={at.x} y1={at.y} x2={at.x} y2={elbowY} className={sleeve} strokeWidth={9} strokeLinecap="round" />
      <g ref={lowerRef}>
        <line x1={at.x} y1={elbowY} x2={at.x} y2={handY - 3} className={sleeve} strokeWidth={8} strokeLinecap="round" />
        <line x1={at.x - 3.4} y1={handY - 2.4} x2={at.x + 3.4} y2={handY - 2.4} className="t-cuff" strokeWidth={1.5} strokeLinecap="round" />
        {markerRef && (
          <g ref={markerRef} style={{ display: 'none' }}>
            <rect x={at.x - 1.3} y={handY + 0.5} width={2.6} height={10} rx={1} className="t-marker" />
            <rect x={at.x - 1.3} y={handY + 8.6} width={2.6} height={2.6} rx={0.9} className="t-marker-tip" />
          </g>
        )}
        {fingerRef && (
          <g ref={fingerRef} style={{ display: 'none' }}>
            <line x1={at.x} y1={handY + 2} x2={at.x} y2={handY + 9} className="t-skin-stroke" strokeWidth={2.3} strokeLinecap="round" />
          </g>
        )}
        <ellipse cx={at.x} cy={handY + 1} rx={3.3} ry={3.8} className="t-skin" />
      </g>
    </g>
  )
}

export default function Teacher({ ref, className = '', reducedMotion = false }) {
  const svgRef = useRef(null)
  const bodyRef = useRef(null)
  const headRef = useRef(null)
  const browsRef = useRef(null)
  const eyeA = useRef(null)
  const eyeB = useRef(null)
  const mouthRef = useRef(null)
  const frontUpper = useRef(null)
  const frontLower = useRef(null)
  const backUpper = useRef(null)
  const backLower = useRef(null)
  const markerRef = useRef(null)
  const fingerRef = useRef(null)
  const dotsRef = useRef(null)

  // Yönetmenin istediği; döngü buna doğru yumuşakça gider.
  const want = useRef({ state: 'idle', aim: null, mouth: 0 })

  useImperativeHandle(ref, () => ({
    setState(state) {
      want.current.state = state
    },
    aimAt(x, y) {
      const rect = svgRef.current?.getBoundingClientRect()
      if (rect && rect.width > 0) want.current.aim = toViewBox({ x, y }, rect, VIEW)
    },
    setMouthOpen(open) {
      want.current.mouth = Math.min(1, Math.max(0, Number.isFinite(open) ? open : 0))
    },
  }), [])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const front = { ...REST_FRONT }
    const back = { ...REST_BACK }
    const look = { x: -0.6, y: 0, tilt: 0, brow: 0 }
    let nextBlink = last + 1500 + Math.random() * 2500
    let blinkUntil = 0
    const eyes = [eyeA, eyeB]

    const loop = (now) => {
      const dt = Math.min(100, now - last)
      last = now
      const { state, aim, mouth } = want.current
      const aiming = (state === 'writing' || state === 'pointing') && aim

      // Kollar
      let frontTarget = REST_FRONT
      if (aiming) {
        frontTarget = reachFor(FRONT_SHOULDER, aim, UPPER, LOWER, { reach: state === 'pointing' ? 0.97 : 0.86, minAngle: 20, maxAngle: 170 })
      } else if (state === 'talking') {
        // Anlatırken el gövdenin önünde, hafifçe hareket eder.
        const sway = reducedMotion ? 0 : 1
        frontTarget = { upper: 12 + sway * 4 * Math.sin(now / 520), lower: 60 + sway * 9 * Math.sin(now / 340) }
      }
      let backTarget = REST_BACK
      if (state === 'thinking') backTarget = { upper: THINK_BACK.upper, lower: THINK_BACK.lower + (reducedMotion ? 0 : 2.5 * Math.sin(now / 260)) }
      for (const [arm, target] of [[front, frontTarget], [back, backTarget]]) {
        arm.upper = approach(arm.upper, target.upper, dt, ARM_TAU_MS)
        arm.lower = approach(arm.lower, target.lower, dt, ARM_TAU_MS)
      }
      frontUpper.current?.setAttribute('transform', `rotate(${deg(front.upper)} ${FRONT_SHOULDER.x} ${FRONT_SHOULDER.y})`)
      frontLower.current?.setAttribute('transform', `rotate(${deg(front.lower)} ${FRONT_SHOULDER.x} ${FRONT_SHOULDER.y + UPPER})`)
      backUpper.current?.setAttribute('transform', `rotate(${deg(back.upper)} ${BACK_SHOULDER.x} ${BACK_SHOULDER.y})`)
      backLower.current?.setAttribute('transform', `rotate(${deg(back.lower)} ${BACK_SHOULDER.x} ${BACK_SHOULDER.y + UPPER})`)
      if (markerRef.current) markerRef.current.style.display = state === 'writing' ? '' : 'none'
      if (fingerRef.current) fingerRef.current.style.display = state === 'pointing' ? '' : 'none'

      // Baş ve gözler: hedefe, düşünürken yukarı, yoksa tahtaya.
      let lookTo = { x: -0.7, y: 0.1, tilt: 0, brow: 0 }
      if (state === 'thinking') lookTo = { x: 0.4, y: -1, tilt: 4, brow: -1.2 }
      else if (state === 'talking') lookTo = { x: -0.5, y: 0, tilt: 0, brow: -0.4 }
      else if (aiming) {
        const dx = aim.x - HEAD.x
        const dy = aim.y - HEAD.y
        const len = Math.hypot(dx, dy) || 1
        lookTo = { x: dx / len, y: dy / len, tilt: Math.max(-5, Math.min(5, (dy / len) * 5)), brow: 0 }
      }
      look.x = approach(look.x, lookTo.x, dt, 140)
      look.y = approach(look.y, lookTo.y, dt, 140)
      look.tilt = approach(look.tilt, lookTo.tilt, dt, 220)
      look.brow = approach(look.brow, lookTo.brow, dt, 160)
      headRef.current?.setAttribute('transform', `rotate(${look.tilt.toFixed(2)} ${HEAD.x} ${HEAD.y + 12})`)
      browsRef.current?.setAttribute('transform', `translate(0 ${look.brow.toFixed(2)})`)

      // Ara sıra göz kırpma (bazen iki kez).
      if (now >= nextBlink) {
        blinkUntil = now + BLINK_MS
        nextBlink = now + (Math.random() < 0.15 ? 260 : 2200 + Math.random() * 3800)
      }
      const closed = now < blinkUntil
      eyes.forEach((r, i) => {
        r.current?.setAttribute('cx', (EYES[i].x + look.x * 0.9).toFixed(2))
        r.current?.setAttribute('cy', (EYES[i].y + look.y * 0.7).toFixed(2))
        r.current?.setAttribute('ry', closed ? '0.2' : String(EYE_OPEN))
      })

      // Ağız: 0 kısa kapalı çizgi, 1 açık.
      mouthRef.current?.setAttribute('ry', (0.35 + mouth * 2).toFixed(2))
      mouthRef.current?.setAttribute('rx', (2.4 - mouth * 0.6).toFixed(2))

      // Düşünme noktaları sırayla belirir; nefes.
      if (dotsRef.current) {
        const visible = state === 'thinking'
        const n = Math.floor(now / 450) % 4
        Array.from(dotsRef.current.children).forEach((c, i) => c.setAttribute('opacity', visible && (reducedMotion || i < n) ? '1' : '0'))
      }
      const breath = reducedMotion ? 0 : Math.sin(now / 900) * 0.5
      bodyRef.current?.setAttribute('transform', `translate(0 ${breath.toFixed(2)})`)

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion])

  return (
    <svg ref={svgRef} viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className={`teacher ${className}`} aria-hidden data-teacher="">
      <g ref={bodyRef}>
        {/* uzak kol, gövdenin arkasında */}
        <Arm at={BACK_SHOULDER} upperRef={backUpper} lowerRef={backLower} far />

        {/* pantolon ve ayakkabılar (burunlar tahtaya dönük) */}
        <path d="M48 124 L49.5 212 L60 212 L62.5 132 L65.5 132 L68 212 L78.5 212 L79 124 Z" className="t-trousers" />
        <path d="M41 220 Q41.5 211.5 50 211.5 L60.5 211.5 L60.5 220 Z" className="t-shoe" />
        <path d="M59.5 220 Q60 211.5 68.5 211.5 L79 211.5 L79 220 Z" className="t-shoe" />

        {/* gövde: düz kesim triko, yakada gömlek */}
        <path d="M47.5 73 Q47.5 64.5 56 63 L72 63 Q80.5 64.5 80.5 73 L79 126 Q64 129 49 126 Z" className="t-top" />
        <path d="M49 120.5 Q64 123.5 79 120.5 L79 126 Q64 129 49 126 Z" className="t-top-hem" />
        <path d="M58.5 61.5 L64 70 L69.5 61.5 L67 60 L64 64.5 L61 60 Z" className="t-shirt" />
        {/* boyun */}
        <path d="M60 50 L68 50 L68.5 61 L64 64.5 L59.5 61 Z" className="t-skin" />

        {/* baş: tahtaya dönük üç çeyrek */}
        <g ref={headRef}>
          <ellipse cx={73.5} cy={41.5} rx={2} ry={3} className="t-skin" />
          <ellipse cx={HEAD.x} cy={HEAD.y} rx={10} ry={12.5} className="t-skin" />
          {/* kısa, yana taranmış saç */}
          <path d="M53.6 38.5 Q52.6 28.5 61 27 Q70.5 25.6 74.6 32.5 Q76 36.5 74.8 41 L72.4 40.4 Q72 35 68.4 33.4 Q63 35.2 57.8 33.8 Q55 35.6 53.6 38.5 Z" className="t-hair" />
          <g ref={browsRef} className="t-brow" fill="none" strokeWidth={0.9} strokeLinecap="round">
            <path d="M55.6 36.6 Q57.6 35.8 59.6 36.4" />
            <path d="M62.6 36.4 Q64.6 35.8 66.4 36.6" />
          </g>
          <ellipse ref={eyeA} cx={EYES[0].x} cy={EYES[0].y} rx={0.9} ry={EYE_OPEN} className="t-eye" />
          <ellipse ref={eyeB} cx={EYES[1].x} cy={EYES[1].y} rx={0.9} ry={EYE_OPEN} className="t-eye" />
          <path d="M56.4 42.4 L55.4 44.6 L56.8 44.8" fill="none" className="t-line" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" />
          <ellipse ref={mouthRef} cx={MOUTH.x} cy={MOUTH.y} rx={2.4} ry={0.35} className="t-mouth" />
        </g>

        {/* düşünme noktaları */}
        <g ref={dotsRef} className="t-dots">
          <circle cx={78} cy={24} r={1.5} opacity={0} />
          <circle cx={84} cy={17} r={2} opacity={0} />
          <circle cx={91.5} cy={10} r={2.6} opacity={0} />
        </g>

        {/* tahtaya yakın kol, gövdenin önünde */}
        <Arm at={FRONT_SHOULDER} upperRef={frontUpper} lowerRef={frontLower} markerRef={markerRef} fingerRef={fingerRef} />
      </g>
    </svg>
  )
}
