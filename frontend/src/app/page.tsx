'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchCurrentUser, readUserLocally } from '@/lib/authSession'
import { resolvePostAuthRedirect } from '@/lib/navigationAccess'

export default function Home() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    void (async () => {
      const sessionUser = await fetchCurrentUser()
      const user = sessionUser ?? readUserLocally()
      if (!user?.id) {
        router.replace('/login')
        return
      }

      try {
        const route = await resolvePostAuthRedirect(user.role, user.id)
        if (route) {
          router.replace(route)
          return
        }
        router.replace('/login?error=no_access')
      } catch {
        router.replace('/login')
      }
    })()
  }, [router])

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold">KLIP</h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    )
  }

  return null
}
