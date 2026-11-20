import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import Teacher from './Teacher'
import { IDLE_ACTIVITY } from '../../lib/board/activity'
import { cueFor } from '../../lib/teacher/director'
import { AudioLevelMeter, flapAt, smoothMouth } from '../../lib/teacher/mouth'

const THINKING = { state: 'thinking', aim: null, speaking: false, mouthFromAudio: false }

// Öğretmeni tahtadan sürer: her karede tahtanın etkinliğini okur (source.current()), duruşa
// (director) ve ağız açıklığına (sesin şiddeti ya da sessizken aç-kapa) çevirir ve figüre yalnızca
// setState / aimAt / setMouthOpen ile iletir. thinking: cevap hazırlanıyor.
export default function TeacherStage({ source, thinking = false, className }) {
  const avatar = useRef(null)
  const reducedMotion = useReducedMotion() ?? false

  useEffect(() => {
    const meter = new AudioLevelMeter()
    let raf = 0
    let last = performance.now()
    let mouth = 0
    let shownState = null

    const loop = (now) => {
      const dt = now - last
      last = now
      const activity = thinking ? IDLE_ACTIVITY : (source?.current?.() ?? IDLE_ACTIVITY)
      const cue = thinking ? THINKING : cueFor(activity)
      const figure = avatar.current
      if (figure) {
        if (cue.state !== shownState) {
          figure.setState(cue.state)
          shownState = cue.state
        }
        if (cue.aim) figure.aimAt(cue.aim.x, cue.aim.y)
        meter.watch(activity.soundOn ? activity.audio : null)
        let target = 0
        if (cue.speaking) target = (cue.mouthFromAudio ? meter.level() : null) ?? flapAt(now)
        mouth = smoothMouth(mouth, target, dt)
        figure.setMouthOpen(mouth < 0.02 ? 0 : mouth)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [source, thinking])

  return <Teacher ref={avatar} className={className} reducedMotion={reducedMotion} />
}
