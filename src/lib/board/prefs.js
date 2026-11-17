// Öğrencinin tahta tercihleri tarayıcıda hatırlanır: hızlı göster, ses, öğretmen.
// Depolama kapalıysa (gizli pencere, engelli site verisi) varsayılanlar kullanılır.

export const BOARD_PREFS_KEY = 'knot.board'

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

// reducedMotion: sistem az hareket istiyor, "Hızlı göster" açık başlar.
export function loadPrefs(reducedMotion = false, store = storage()) {
  const defaults = { fast: reducedMotion, audio: true, teacher: true }
  try {
    const parsed = JSON.parse(store?.getItem(BOARD_PREFS_KEY) || 'null')
    if (!parsed) return defaults
    const pick = (k) => (typeof parsed[k] === 'boolean' ? parsed[k] : defaults[k])
    return { fast: pick('fast'), audio: pick('audio'), teacher: pick('teacher') }
  } catch {
    return defaults
  }
}

export function savePrefs(prefs, store = storage()) {
  try {
    store?.setItem(BOARD_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Bu sefer hatırlanmaz; seçim bu sayfada yine geçerli.
  }
}
