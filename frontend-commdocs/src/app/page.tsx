'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Spinner } from '@/components/ui'
import { homePath } from '@/lib/access'
import { useSession } from '@/lib/session'

/** "/" sends the user to their first page, or to sign-in. */
export default function Home() {
  const { status, access } = useSession()
  const router = useRouter()
  useEffect(() => {
    if (status === 'loading') return
    router.replace(status === 'signedIn' ? homePath(access) || '/no-access' : '/login')
  }, [status, access, router])
  return (
    <div className="center-page">
      <Spinner />
    </div>
  )
}
