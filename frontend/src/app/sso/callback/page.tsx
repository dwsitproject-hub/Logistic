'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthLoading } from '@/components/auth/AuthParts'
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

  return <AuthLoading label={message} />
}

export default function SsoCallbackPage() {
  return (
    <Suspense fallback={<AuthLoading label="Completing sign-in..." />}>
      <SsoCallbackContent />
    </Suspense>
  )
}
