'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { resolvePostAuthRedirect } from '@/lib/navigationAccess'

export default function Home() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const token = localStorage.getItem('token')
    if (!token) {
      router.replace('/login')
      return
    }

    const userStr = localStorage.getItem('user')
    const userRole = userStr ? (JSON.parse(userStr).role as string | undefined) : undefined
    void resolvePostAuthRedirect(userRole)
      .then((route) => {
        if (route) {
          router.replace(route)
          return
        }
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        router.replace('/login?error=no_access')
      })
      .catch(() => {
        router.replace('/login')
      })
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

