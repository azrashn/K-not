import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as session from '../api/session'
import { api } from '../api/endpoints'

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
  const logout = useCallback(() => session.end('logout'), [])

  const value = useMemo(() => ({
    user: state.session?.user ?? null,
    authenticated: Boolean(state.session),
    expired: state.reason === 'expired',
    login,
    logout,
  }), [state, login, logout])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
