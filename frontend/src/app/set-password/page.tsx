'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold text-center">KLIP</CardTitle>
          <CardDescription className="text-center">
            {link.status === 'valid' ? copy.title : 'KPN Logistics Intelligence Platform'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {link.status === 'checking' && <p className="text-center text-sm text-gray-500">Checking your link...</p>}

          {link.status === 'invalid' && (
            <div className="space-y-4">
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                This link is invalid or has expired. Please request a new one.
              </div>
              <Button asChild className="w-full">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
              <div className="text-center">
                <Link href="/login" className="text-sm text-blue-600 hover:underline">
                  Back to login
                </Link>
              </div>
            </div>
          )}

          {link.status === 'done' && (
            <div className="space-y-4">
              <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                {link.message}
              </div>
              <Button className="w-full" onClick={() => router.push('/login')}>
                Go to login
              </Button>
            </div>
          )}

          {link.status === 'valid' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-600">
                {link.fullName ? `Hi ${link.fullName}. ` : ''}
                {copy.description}
              </p>
              <p className="text-xs text-gray-500">Account: {link.email}</p>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Enter new password (min 6 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={saving}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Re-enter new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  disabled={saving}
                  required
                />
              </div>
              {error && (
                <div role="alert" className="text-sm text-red-500 text-center">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? 'Saving...' : copy.submitLabel}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <SetPasswordContent />
    </Suspense>
  )
}
