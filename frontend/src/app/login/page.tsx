'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ChangePasswordModal from '@/components/ChangePasswordModal'
import api from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [isFirstLogin, setIsFirstLogin] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await api.post('/auth/login', { username, password })
      const { user, token, requirePasswordChange } = response.data.data

      localStorage.setItem('token', token)
      localStorage.setItem('user', JSON.stringify(user))

      // Check if password change is required
      if (requirePasswordChange) {
        setIsFirstLogin(true)
        setShowPasswordModal(true)
        setLoading(false)
      } else {
        router.push('/dashboard')
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Login failed')
      setLoading(false)
    }
  }

  const handlePasswordChangeSuccess = () => {
    // Update user object to reflect password has been changed
    const userStr = localStorage.getItem('user')
    if (userStr) {
      const user = JSON.parse(userStr)
      user.is_first_login = false
      localStorage.setItem('user', JSON.stringify(user))
    }
    
    router.push('/dashboard')
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
          <div className="mt-6 text-sm text-muted-foreground">
            <p className="font-semibold mb-2">Demo Credentials:</p>
            <ul className="space-y-1 text-xs">
              <li>Admin: admin / admin123</li>
              <li>Trading: trading / trading123</li>
              <li>Logistics: logistics / logistics123</li>
              <li>Finance: finance / finance123</li>
              <li>Management: management / management123</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
    </>
  )
}

