import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as session from '../api/session'
import { api } from '../api/endpoints'
import { clearProgressOutbox, drainProgressOutbox } from '../lib/outbox-sync'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [state, setState] = useState(() => ({ session: session.load(), reason: null }))

  useEffect(() => session.subscribe((s, reason) => setState({ session: s, reason })), [])

  const login = useCallback(async (email, password) => {
    const res = await api.login(email, password)
    session.start(res)
    return res.user
  }, [])
  // An explicit sign-out on a shared device removes this user's unsent watch progress; an expired
  // session keeps it, because it still belongs to the user and is sent after the next sign-in.
  const logout = useCallback(() => {
    const userId = session.get()?.user?.id
    session.end('logout')
    void clearProgressOutbox(userId)
  }, [])

  // Progress left by an offline session is sent as soon as someone is signed in and online.
  const signedIn = Boolean(state.session)
  useEffect(() => {
    if (!signedIn) return
    const send = () => void drainProgressOutbox()
    send()
    window.addEventListener('online', send)
    return () => window.removeEventListener('online', send)
  }, [signedIn])

  const value = useMemo(() => ({
    user: state.session?.user ?? null,
    authenticated: Boolean(state.session),
    expired: state.reason === 'expired',
    login,
    logout,
  }), [state, login, logout])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
