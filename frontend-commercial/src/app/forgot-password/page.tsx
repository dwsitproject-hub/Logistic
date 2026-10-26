'use client'

import { Mail } from 'lucide-react'
import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { AuthFrame } from '@/components/AuthFrame'
import { ErrorNote } from '@/components/ui'
import { apiJson, errorMessage } from '@/lib/api'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      // app: 'commercial' makes the e-mailed link open this app instead of KLIP (when the server knows this app's URL).
      await apiJson('/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim(), app: 'commercial' },
        expectAuthError: true,
      })
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <div>
        <h1>Reset your password</h1>
        <p className="hint" style={{ margin: '4px 0 0' }}>
          We e-mail you a link to choose a new one. Your password is the same for KLIP.
        </p>
      </div>
      {sent ? (
        <div className="alert ok" role="status">
          If that e-mail belongs to an active account, a reset link is on its way. It works once and expires in 60 minutes.
        </div>
      ) : (
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
          <ErrorNote>{error}</ErrorNote>
          <button className="btn primary wide" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className="hint" style={{ margin: 0 }}>
        <Link className="link" href="/login">
          Back to sign in
        </Link>
      </p>
    </AuthFrame>
  )
}
