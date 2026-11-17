// Tahtanın o anki etkinliğini (lib/board/activity.js) öğretmenin duruşuna çevirir. Saf fonksiyon;
// figür yalnızca setState / aimAt / setMouthOpen çağrılarını alır.
// - oynamıyor → idle (bekliyor); cevap ya da ses bekleniyor → thinking (düşünüyor)
// - not / formül yazılıyor → writing, el kalemi izler
// - vurgu çiziliyor → pointing; kaynaklar yeni göründü → bir an onları gösterir
// - adım anlatılırken başka bir şey yoksa → talking (konuşuyor)

export const TEACHER_STATES = ['idle', 'thinking', 'talking', 'writing', 'pointing']

// Kaynaklar göründüğünde öğretmen onları bu kadar süre gösterir.
export const POINT_SOURCES_MS = 1400

// { state, aim, speaking, mouthFromAudio } döner.
export function cueFor(a) {
  const audioPlaying = !!a.audio && !a.audio.paused && !a.audio.ended
  const quiet = { speaking: false, mouthFromAudio: false }
  if (!a.playing) return { state: 'idle', aim: null, ...quiet }
  if (a.waiting) return { state: 'thinking', aim: null, ...quiet }

  const speaking = a.soundOn ? audioPlaying : a.step >= 0
  const voice = { speaking, mouthFromAudio: a.soundOn }

  if (a.phase === 'writing' && a.pen) return { state: 'writing', aim: a.pen, ...voice }
  if (a.phase === 'marking') {
    const at = a.mark ?? a.pen
    if (at) return { state: 'pointing', aim: at, ...voice }
  }
  if (a.phase === 'done' && a.sources && a.sinceSourcesMs !== null && a.sinceSourcesMs < POINT_SOURCES_MS) {
    return { state: 'pointing', aim: a.sources, ...voice }
  }
  if (a.step < 0) return { state: 'idle', aim: null, ...quiet }
  return { state: 'talking', aim: null, ...voice }
}
