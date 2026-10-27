'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { AuthFrame } from '@/components/AuthFrame'
import { Spinner } from '@/components/ui'
import { homePath } from '@/lib/access'
import { setToken } from '@/lib/api'
import { useSession } from '@/lib/session'

/**
 * Completes a DWS Hub sign-in: the backend redirects here with a short-lived JWT in `?t=` (the session cookie may not survive the
 * cross-site hop from the Hub on plain HTTP). The token is kept like a password sign-in keeps it, taken out of the address bar, and the
 * session provider then loads the user and permissions.
 */
export default function SsoCallbackPage() {
  const { status, access } = useSession()
  const router = useRouter()

  // Children's effects run before the provider's first load, so the token is already stored when the provider asks /auth/me.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('t')
    if (token) {
      setToken(token)
      window.history.replaceState({}, '', '/sso/callback')
    }
  }, [])

  useEffect(() => {
    if (status === 'signedIn') router.replace(homePath(access) || '/no-access')
    if (status === 'signedOut') router.replace('/login?error=sso_failed')
  }, [status, access, router])

  return (
    <AuthFrame>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Spinner label="Completing sign-in" />
        <span className="hint">Completing sign-in...</span>
      </div>
    </AuthFrame>
  )
}
