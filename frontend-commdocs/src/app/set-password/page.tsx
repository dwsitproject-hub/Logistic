'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { AuthFrame } from '@/components/AuthFrame'
import { ErrorNote, Spinner } from '@/components/ui'
import { apiData, apiJson, errorMessage } from '@/lib/api'

const MIN_LENGTH = 6 // backend MIN_PASSWORD_LENGTH

type TokenInfo = { valid: false } | { valid: true; purpose: 'INVITE' | 'RESET'; full_name: string | null; email: string }

/** Target of the invitation and reset e-mails: /set-password?token=... */
export default function SetPasswordPage() {
  const [token, setToken] = useState<string | null>(null)
  const [info, setInfo] = useState<TokenInfo | null>(null)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Read from the URL on the client; useSearchParams would need a Suspense boundary for no gain here.
    const t = new URLSearchParams(window.location.search).get('token') || ''
    setToken(t)
    if (!t) {
      setInfo({ valid: false })
      return
    }
    apiData<TokenInfo>('/auth/password-token/validate', { method: 'POST', body: { token: t }, expectAuthError: true })
      .then(setInfo)
      .catch((err) => {
        setInfo({ valid: false })
        setError(errorMessage(err))
      })
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !token) return
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== repeat) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await apiJson('/auth/set-password', { method: 'POST', body: { token, newPassword: password }, expectAuthError: true })
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!info) {
    return (
      <AuthFrame>
        <Spinner />
      </AuthFrame>
    )
  }

  if (!info.valid) {
    return (
      <AuthFrame>
        <div>
          <h1>This link no longer works</h1>
          <p className="hint" style={{ margin: '4px 0 0' }}>
            Links work once and expire. Ask for a new one below, or ask an administrator to send a new invitation.
          </p>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <Link className="btn primary wide" href="/forgot-password">
          Send me a new link
        </Link>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame>
      <div>
        <h1>{info.purpose === 'INVITE' ? 'Choose your password' : 'Choose a new password'}</h1>
        <p className="hint" style={{ margin: '4px 0 0' }}>
          {info.full_name ? `${info.full_name} · ` : ''}
          {info.email}. The same password signs you in to KLIP.
        </p>
      </div>
      {done ? (
        <>
          <div className="alert ok" role="status">
            Your password has been saved. You can sign in now.
          </div>
          <Link className="btn primary wide" href="/login">
            Go to sign in
          </Link>
        </>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 18 }}>
          <div className="field">
            <label htmlFor="pw1">New password</label>
            <input
              className="input"
              id="pw1"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="hint">At least {MIN_LENGTH} characters.</span>
          </div>
          <div className="field">
            <label htmlFor="pw2">Repeat new password</label>
            <input
              className="input"
              id="pw2"
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </div>
          <ErrorNote>{error}</ErrorNote>
          <button className="btn primary wide" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </form>
      )}
    </AuthFrame>
  )
}
