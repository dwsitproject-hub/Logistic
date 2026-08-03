'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ChangePasswordModal from '@/components/ChangePasswordModal'
import api from '@/lib/api'
import {
  fetchCurrentUser,
  fetchLoginOptions,
  startHubOidcLogin,
  storeUserLocally,
  type LoginOptions,
} from '@/lib/authSession'
import { redirectAfterAuth, resolvePostAuthRedirect, type StoredAuthUser } from '@/lib/navigationAccess'

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [isFirstLogin, setIsFirstLogin] = useState(false)
  const [loginOptions, setLoginOptions] = useState<LoginOptions>({
    localLogin: true,
    hubSso: false,
  })

  useEffect(() => {
    void fetchLoginOptions().then(setLoginOptions)
  }, [])

  useEffect(() => {
    const errorCode = searchParams.get('error')
    if (errorCode === 'no_access') {
      setError('Your account has no accessible pages. Contact your administrator.')
    } else if (errorCode === 'sso_no_access') {
      setError('Your account is not registered for SSO access. Contact your administrator.')
    } else if (errorCode === 'sso_failed' || errorCode === 'sso_not_configured') {
      setError('SSO login failed. Please try again or use your KLIP username/password.')
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
      const response = await api.post('/auth/login', { username, password })
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
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold text-center">KLIP</CardTitle>
          <CardDescription className="text-center">
            KPN Logistics Intelligence Platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {loginOptions.localLogin ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && (
                  <div className="text-sm text-red-500 text-center">{error}</div>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Logging in...' : 'Login with KLIP account'}
                </Button>
              </>
            ) : (
              error && (
                <div className="text-sm text-red-500 text-center">{error}</div>
              )
            )}

            {loginOptions.localLogin && loginOptions.hubSso && (
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-muted-foreground">Or</span>
                </div>
              </div>
            )}

            {loginOptions.hubSso && (
              <Button
                type="button"
                variant={loginOptions.localLogin ? 'outline' : 'default'}
                className="w-full"
                disabled={loading}
                onClick={() => startHubOidcLogin()}
              >
                Sign in with DWS Hub
              </Button>
            )}

            {!loginOptions.localLogin && !loginOptions.hubSso && (
              <p className="text-sm text-center text-red-500">
                No login method is configured. Contact your administrator.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
    </>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}
