'use client'

import { Suspense, useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Legacy SSO exchange callback — OIDC now completes on GET /auth/oidc/callback (backend). */
function SsoCallbackContent() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <p className="text-gray-500">Redirecting...</p>
    </div>
  )
}

export default function SsoCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
          <p className="text-gray-500">Redirecting...</p>
        </div>
      }
    >
      <SsoCallbackContent />
    </Suspense>
  )
}
