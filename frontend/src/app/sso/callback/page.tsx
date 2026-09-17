'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchCurrentUser, storeUserLocally } from '@/lib/authSession'
import { redirectAfterAuth } from '@/lib/navigationAccess'

/** Completes OIDC SSO — backend redirects here with a short-lived JWT query param. */
function SsoCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('Completing sign-in...')

  useEffect(() => {
    void (async () => {
      const token = searchParams.get('t')
      if (token) {
        localStorage.setItem('token', token)
        window.history.replaceState({}, '', '/sso/callback')
      }

      const user = await fetchCurrentUser()
      if (user?.id) {
        storeUserLocally(user)
        await redirectAfterAuth(user, router, setMessage)
        return
      }

      router.replace('/login?error=sso_failed')
    })()
  }, [router, searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <p className="text-gray-500">{message}</p>
    </div>
  )
}

export default function SsoCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
          <p className="text-gray-500">Completing sign-in...</p>
        </div>
      }
    >
      <SsoCallbackContent />
    </Suspense>
  )
}
