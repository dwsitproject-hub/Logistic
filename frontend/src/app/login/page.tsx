'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Lock, Mail } from 'lucide-react'
import { AuthFrame } from '@/components/auth/AuthFrame'
import { AuthAlert, AuthField, AuthLoading } from '@/components/auth/AuthParts'
import ChangePasswordModal from '@/components/ChangePasswordModal'
import api from '@/lib/api'
import Link from 'next/link'
import {
  fetchCurrentUser,
  fetchLoginOptions,
  storeUserLocally,
} from '@/lib/authSession'
import { redirectAfterAuth, resolvePostAuthRedirect, type StoredAuthUser } from '@/lib/navigationAccess'

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [isFirstLogin, setIsFirstLogin] = useState(false)
  /** "Forgot password?" resets a local password, so it is hidden when the server has local login switched off. */
  const [localLoginEnabled, setLocalLoginEnabled] = useState(true)

  useEffect(() => {
    void fetchLoginOptions().then((options) => setLocalLoginEnabled(options.localLogin))
  }, [])

  useEffect(() => {
    const errorCode = searchParams.get('error')
    if (errorCode === 'no_access') {
      setError('Your account has no accessible pages. Contact your administrator.')
    } else if (errorCode === 'sso_no_access') {
      setError('Your account is not registered for SSO access. Contact your administrator.')
    } else if (errorCode === 'sso_failed' || errorCode === 'sso_not_configured') {
      setError('SSO login failed. Please try again or use your KLIP email/password.')
    }
  }, [searchParams])

  useEffect(() => {
    void (async () => {
      try {
        const user = await fetchCurrentUser()
        if (user?.id) {
          const route = await resolvePostAuthRedirect(user.role, user.id)
          router.replace(route || '/')
          return
        }
      } catch {
        /* not logged in */
      } finally {
        setCheckingSession(false)
      }
    })()
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await api.post('/auth/login', { email, password })
      const payload = response.data?.data
      if (!payload?.user) {
        setError('Unexpected server response. Please contact support.')
        return
      }
      const { user, token, requirePasswordChange } = payload

      if (!token) {
        setError('Login succeeded but no auth token was returned. Contact support.')
        return
      }

      storeUserLocally(user)
      localStorage.setItem('token', token)

      if (requirePasswordChange) {
        setIsFirstLogin(true)
        setShowPasswordModal(true)
      } else {
        await redirectAfterAuth(user, router, setError)
      }
    } catch (err: any) {
      if (err.code === 'ERR_NETWORK' || !err.response) {
        setError('Cannot reach KLIP server. Check your connection or try again later.')
      } else {
        setError(err.response?.data?.error?.message || 'Login failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordChangeSuccess = async () => {
    setShowPasswordModal(false)
    const userStr = localStorage.getItem('user')
    let user: StoredAuthUser = {}
    if (userStr) {
      user = JSON.parse(userStr) as StoredAuthUser
      user.is_first_login = false
      storeUserLocally(user)
    }

    setLoading(true)
    await redirectAfterAuth(user, router, setError)
    setLoading(false)
  }

  if (checkingSession) {
    return <AuthLoading label="Loading..." />
  }

  return (
    <>
      {showPasswordModal && (
        <ChangePasswordModal
          isOpen={showPasswordModal}
          isFirstLogin={isFirstLogin}
          onClose={() => {}}
          onSuccess={handlePasswordChangeSuccess}
        />
      )}
      <AuthFrame>
        <div>
          <h1>Sign in</h1>
          <p className="klip-auth-hint" style={{ marginTop: 4 }}>
            Use your KLIP email and password.
          </p>
        </div>
        <form onSubmit={handleLogin} style={{ display: 'grid', gap: 18 }}>
          <AuthField
            id="email"
            label="Email"
            icon={Mail}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <AuthField
            id="password"
            label="Password"
            icon={Lock}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <AuthAlert tone="bad">{error}</AuthAlert>
          <button className="klip-auth-btn" type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        {localLoginEnabled && (
          <p className="klip-auth-hint">
            Forgot your password?{' '}
            <Link className="klip-auth-link" href="/forgot-password">
              Send me a reset link
            </Link>
          </p>
        )}
      </AuthFrame>
    </>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthLoading label="Loading..." />}>
      <LoginPageContent />
    </Suspense>
  )
}
