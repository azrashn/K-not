import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuth } from '../app/auth'
import { errorText } from '../api/messages'
import { KnotMark } from '../components/NavRail'
import { Btn } from '../components/ui'
import { EASE_OUT } from '../lib/motion'

// Giriş: hesaplar yönetici tarafından açılır (kayıt yok — U1 kararı).
export default function Login() {
  const reduce = useReducedMotion()
  const { login, expired } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password || busy) return
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err?.code === 'UNAUTHENTICATED' ? 'E-posta ya da parola hatalı.' : errorText(err))
      setBusy(false)
    }
  }

  return (
    <main className="grid h-dvh place-items-center overflow-y-auto bg-paper px-5">
      <motion.div
        initial={{ opacity: 0, y: reduce ? 0 : 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } }}
        className="w-full max-w-[24rem] py-12"
      >
        <KnotMark size={40} />
        <h1 className="display m-0 mt-6 text-[40px] text-ink">K-not’a giriş</h1>
        <p className="m-0 mt-2 text-[15px] leading-relaxed text-ink-2">Hesabın dersin yöneticisi tarafından açılır.</p>

        {expired && !error && (
          <p role="status" className="m-0 mt-6 rounded-xl bg-gevesek-tint px-4 py-3 text-[14px] text-gevesek">Oturumun sona erdi. Lütfen yeniden giriş yap.</p>
        )}

        <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">E-posta</span>
            <input
              type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl bg-white px-4 text-[15px] text-ink outline-none shadow-[0_0_0_1px_rgba(22,24,30,0.1)] focus:shadow-[0_0_0_2px_var(--color-accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Parola</span>
            <input
              type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl bg-white px-4 text-[15px] text-ink outline-none shadow-[0_0_0_1px_rgba(22,24,30,0.1)] focus:shadow-[0_0_0_2px_var(--color-accent)]"
            />
          </label>
          {error && <p role="alert" className="m-0 text-[14px] text-kopuk">{error}</p>}
          <Btn type="submit" className="w-full" disabled={busy || !email.trim() || !password}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</Btn>
        </form>
      </motion.div>
    </main>
  )
}
