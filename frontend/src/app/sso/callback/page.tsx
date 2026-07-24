'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { redirectAfterAuth } from '@/lib/navigationAccess'

function SsoCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) {
      router.replace('/login?error=sso_failed')
      return
    }

    let cancelled = false

    const exchange = async () => {
      try {
        const response = await api.post('/auth/sso/exchange', { code })
        const payload = response.data?.data
        if (cancelled) return
        if (!payload?.token || !payload?.user) {
          router.replace('/login?error=sso_failed')
          return
        }

        localStorage.setItem('token', payload.token)
        localStorage.setItem('user', JSON.stringify(payload.user))

        await redirectAfterAuth(payload.user, router, (msg) => {
          if (!cancelled) setError(msg)
        })
      } catch {
        if (!cancelled) router.replace('/login?error=sso_failed')
      }
    }

    exchange()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : (
        <p className="text-gray-500">Signing you in...</p>
      )}
    </div>
  )
}

export default function SsoCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
          <p className="text-gray-500">Signing you in...</p>
        </div>
      }
    >
      <SsoCallbackContent />
    </Suspense>
  )
}
