'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { AuthFrame } from '@/components/AuthFrame'
import { homePath } from '@/lib/access'
import { useSession } from '@/lib/session'

/** Signed in, but the role opens no page of this app (e.g. a logistics-only KLIP account). */
export default function NoAccessPage() {
  const { status, access, user, signOut } = useSession()
  const router = useRouter()
  const klipUrl = process.env.NEXT_PUBLIC_KLIP_URL

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login')
    if (status === 'signedIn' && homePath(access)) router.replace(homePath(access)!)
  }, [status, access, router])

  return (
    <AuthFrame>
      <div>
        <h1>No access to Commercial Documents</h1>
        <p className="hint" style={{ margin: '4px 0 0' }}>
          {user ? `Signed in as ${user.email} (${user.role}). ` : ''}Your role has no page in this app. Ask an administrator to
          grant Documents or Dashboard in Roles &amp; access.
        </p>
      </div>
      {klipUrl ? (
        <a className="btn primary wide" href={klipUrl}>
          Open KLIP
        </a>
      ) : null}
      <button className="btn wide" type="button" onClick={() => void signOut().then(() => router.replace('/login'))}>
        Sign out
      </button>
    </AuthFrame>
  )
}
