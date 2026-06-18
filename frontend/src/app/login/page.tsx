'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ChangePasswordModal from '@/components/ChangePasswordModal'
import api from '@/lib/api'
import { resolvePostAuthRedirect } from '@/lib/navigationAccess'

type StoredAuthUser = {
  id?: string
  role?: string
  is_first_login?: boolean
}

async function redirectAfterAuth(
  user: StoredAuthUser,
  router: ReturnType<typeof useRouter>,
  setError: (msg: string) => void,
) {
  try {
    const route = await resolvePostAuthRedirect(user.role, user.id)
    if (!route) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      setError('Your account has no accessible pages. Contact your administrator.')
      return
    }
    router.push(route)
  } catch {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setError('Failed to load your permissions. Please try again.')
  }
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [isFirstLogin, setIsFirstLogin] = useState(false)

  useEffect(() => {
    if (searchParams.get('error') === 'no_access') {
      setError('Your account has no accessible pages. Contact your administrator.')
    }
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await api.post('/auth/login', { username, password })
      const payload = response.data?.data
      if (!payload?.token || !payload?.user) {
        setError('Unexpected server response. Please contact support.')
        return
      }
      const { user, token, requirePasswordChange } = payload

      localStorage.setItem('token', token)
      localStorage.setItem('user', JSON.stringify(user))

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
      localStorage.setItem('user', JSON.stringify(user))
    }

    setLoading(true)
    await redirectAfterAuth(user, router, setError)
    setLoading(false)
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
              {loading ? 'Logging in...' : 'Login'}
            </Button>
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

