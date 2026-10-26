'use client'

import { Lock, Mail } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { AuthFrame } from '@/components/AuthFrame'
import { ErrorNote } from '@/components/ui'
import { homePath } from '@/lib/access'
import { errorMessage } from '@/lib/api'
import { SIGNED_OUT_REASON_KEY, useSession } from '@/lib/session'

export default function LoginPage() {
  const { status, access, signIn } = useSession()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SIGNED_OUT_REASON_KEY) === 'expired') {
        setNotice('Your session ended. Please sign in again.')
      }
      sessionStorage.removeItem(SIGNED_OUT_REASON_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  // Already signed in (or just signed in): go to the first page this user may open.
  useEffect(() => {
    if (status === 'signedIn') router.replace(homePath(access) || '/no-access')
  }, [status, access, router])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed. Please try again.'))
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <div>
        <h1>Sign in</h1>
        <p className="hint" style={{ margin: '4px 0 0' }}>
          Use the same email and password as KLIP.
        </p>
      </div>
      {notice ? <div className="alert info">{notice}</div> : null}
      <form onSubmit={submit} style={{ display: 'grid', gap: 18 }}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <div className="input-ic">
            <Mail aria-hidden />
            <input
              className="input"
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="input-ic">
            <Lock aria-hidden />
            <input
              className="input"
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn primary wide" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="hint" style={{ margin: 0 }}>
        Forgot your password?{' '}
        <Link className="link" href="/forgot-password">
          Send me a reset link
        </Link>
      </p>
    </AuthFrame>
  )
}
