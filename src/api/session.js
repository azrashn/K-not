// Oturum: yalnızca kullanıcı JWT'si (kısa ömürlü, yenileme yok — U1 kararı).
// sessionStorage: sekme kapanınca biter. Servisler arası gizli anahtarlar asla tarayıcıya gelmez.
const KEY = 'knot.session'
const listeners = new Set()
let current = null
let timer = null

function storage() {
  try { return window.sessionStorage } catch { return null }
}

function emit(reason) {
  for (const fn of listeners) fn(current, reason)
}

function schedule() {
  clearTimeout(timer)
  if (!current) return
  const ms = current.expiresAt - Date.now()
  if (ms <= 0) return expire()
  timer = setTimeout(expire, Math.min(ms, 2 ** 31 - 1))
}

export function load() {
  try {
    const raw = storage()?.getItem(KEY)
    const s = raw ? JSON.parse(raw) : null
    current = s && s.token && s.expiresAt > Date.now() ? s : null
  } catch {
    current = null
  }
  if (!current) storage()?.removeItem(KEY)
  schedule()
  return current
}

export const get = () => current
export const token = () => current?.token ?? null

/** Tarayıcıda saklanan kişisel değerlerin anahtarı: aynı tarayıcıdaki başka kullanıcı görmesin. */
export const userScopedKey = (base) => `${base}:${current?.user?.id ?? 'anon'}`

/** Çıkışta ya da oturum bitince bu kullanıcıya ait kişisel anahtarları siler. */
export function clearUserScoped(userId) {
  try {
    const suffix = `:${userId ?? 'anon'}`
    for (const k of Object.keys(window.localStorage)) {
      if ((k.startsWith('knot-exam') || k.startsWith('knot.last-material.')) && k.endsWith(suffix)) window.localStorage.removeItem(k)
    }
  } catch { /* depolama kapalı */ }
}

/** `login` yanıtından: { access_token, expires_in, user } */
export function start({ access_token, expires_in, user }) {
  current = { token: access_token, user, expiresAt: Date.now() + expires_in * 1000 }
  storage()?.setItem(KEY, JSON.stringify(current))
  schedule()
  emit('login')
}

export function end(reason = 'logout') {
  clearTimeout(timer)
  if (reason === 'logout') clearUserScoped(current?.user?.id)
  current = null
  storage()?.removeItem(KEY)
  emit(reason)
}

export function expire() {
  if (current) end('expired')
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
