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

/** `login` yanıtından: { access_token, expires_in, user } */
export function start({ access_token, expires_in, user }) {
  current = { token: access_token, user, expiresAt: Date.now() + expires_in * 1000 }
  storage()?.setItem(KEY, JSON.stringify(current))
  schedule()
  emit('login')
}

export function end(reason = 'logout') {
  clearTimeout(timer)
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
