// Tahtanın o an ne yaptığı; tahta her karede bildirir. Onu kimin sunduğunu (öğretmen ya da hiç
// kimse) bilmez. Noktalar ekran (client) koordinatındadır.
// { playing, waiting, step, phase, pen, mark, sources, sinceSourcesMs, soundOn, audio }

export const IDLE_ACTIVITY = {
  playing: false,
  waiting: false,
  step: -1,
  phase: null,
  pen: null,
  mark: null,
  sources: null,
  sinceSourcesMs: null,
  soundOn: false,
  audio: null,
}

const center = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })

function unionRect(elements) {
  let box = null
  for (const el of elements) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    box = box
      ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
      : { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }
  return box
}

// Bir adımın kalem ucu, vurgusu ve kaynakları ekranda nerede (data-board-* işaretlerinden).
export function readStepTargets(item) {
  if (!item) return { pen: null, mark: null, sources: null }
  const penRect = item.querySelector('[data-board-pen]')?.getBoundingClientRect()
  // Kalemin ucu sol alt köşesidir.
  const pen = penRect && penRect.width > 0 ? { x: penRect.left, y: penRect.bottom } : null
  const markBox = unionRect(item.querySelectorAll('[data-board-mark] path'))
  const sourcesEl = item.querySelector('[data-board-sources]')
  const shown = sourcesEl && getComputedStyle(sourcesEl).visibility !== 'hidden'
  const sourcesBox = shown ? unionRect(sourcesEl.querySelectorAll('button, a')) ?? unionRect([sourcesEl]) : null
  return { pen, mark: markBox ? center(markBox) : null, sources: sourcesBox ? center(sourcesBox) : null }
}
