'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Lock } from 'lucide-react'
import { AuthFrame } from '@/components/auth/AuthFrame'
import { AuthAlert, AuthField, AuthLoading } from '@/components/auth/AuthParts'
import api from '@/lib/api'
import {
  describePasswordLink,
  readTokenFromSearch,
  validateNewPassword,
  type PasswordLinkPurpose,
} from '@/lib/passwordLink'

type LinkState =
  | { status: 'checking' }
  | { status: 'invalid' }
  | { status: 'valid'; purpose: PasswordLinkPurpose; fullName: string | null; email: string }
  | { status: 'done'; message: string }

function SetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Read once: the token is removed from the address bar below so it does not stay in history or leak through a Referer.
  const [token] = useState(() => readTokenFromSearch(`?${searchParams.toString()}`))
  const [link, setLink] = useState<LinkState>({ status: 'checking' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    if (!token) {
      setLink({ status: 'invalid' })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const response = await api.post('/auth/password-token/validate', { token })
        const data = response.data?.data
        if (cancelled) return
        if (data?.valid) {
          setLink({
            status: 'valid',
            purpose: data.purpose === 'INVITE' ? 'INVITE' : 'RESET',
            fullName: data.full_name ?? null,
            email: String(data.email ?? ''),
          })
        } else {
          setLink({ status: 'invalid' })
        }
      } catch {
        if (!cancelled) setLink({ status: 'invalid' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const problem = validateNewPassword(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    try {
      const response = await api.post('/auth/set-password', { token, newPassword: password })
      setLink({
        status: 'done',
        message: response.data?.data?.message || 'Your password has been saved. You can sign in now.',
      })
    } catch (err: any) {
      if (err.code === 'ERR_NETWORK' || !err.response) {
        setError('Cannot reach KLIP server. Check your connection or try again later.')
      } else {
        setError(err.response?.data?.error?.message || 'Failed to save the password')
      }
    } finally {
      setSaving(false)
    }
  }

  const copy = describePasswordLink(link.status === 'valid' ? link.purpose : null)

  if (link.status === 'checking') return <AuthLoading label="Checking your link..." />

  return (
    <AuthFrame>
      {link.status === 'invalid' && (
        <>
          <h1>Link not valid</h1>
          <AuthAlert tone="bad">This link is invalid or has expired. Please request a new one.</AuthAlert>
          <Link className="klip-auth-btn" href="/forgot-password">
            Request a new link
          </Link>
          <p className="klip-auth-hint" style={{ textAlign: 'center' }}>
            <Link className="klip-auth-link" href="/login">
              Back to login
            </Link>
          </p>
        </>
      )}

      {link.status === 'done' && (
        <>
          <h1>Password saved</h1>
          <AuthAlert tone="ok">{link.message}</AuthAlert>
          <button className="klip-auth-btn" type="button" onClick={() => router.push('/login')}>
            Go to login
          </button>
        </>
      )}

      {link.status === 'valid' && (
        <>
          <div>
            <h1>{copy.title}</h1>
            <p className="klip-auth-hint" style={{ marginTop: 4 }}>
              {link.fullName ? `Hi ${link.fullName}. ` : ''}
              {copy.description}
            </p>
            <p className="klip-auth-hint">Account: {link.email}</p>
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 18 }}>
            <AuthField
              id="newPassword"
              label="New Password"
              icon={Lock}
              type="password"
              placeholder="Min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={saving}
              required
            />
            <AuthField
              id="confirmPassword"
              label="Confirm New Password"
              icon={Lock}
              type="password"
              placeholder="Re-enter new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={saving}
              required
            />
            <AuthAlert tone="bad">{error}</AuthAlert>
            <button className="klip-auth-btn" type="submit" disabled={saving}>
              {saving ? 'Saving...' : copy.submitLabel}
            </button>
          </form>
        </>
      )}
    </AuthFrame>
  )
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoading label="Loading..." />}>
      <SetPasswordContent />
    </Suspense>
  )
}
