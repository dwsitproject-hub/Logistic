'use client'

import { BarChart3, Bug, ExternalLink, FileText, History, KeyRound, LogOut, Menu, ShieldCheck, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { Brand, Spinner, useToast } from '@/components/ui'
import { NAV, homePath, navKeyForPath, type NavKey } from '@/lib/access'
import { initials } from '@/lib/format'
import { hubOpenBugReport, isHubSdkEnabled } from '@/lib/hubSdk'
import { useSession } from '@/lib/session'

const ICONS: Record<NavKey, typeof FileText> = {
  dashboard: BarChart3,
  documents: FileText,
  users: Users,
  roles: ShieldCheck,
  audit: History,
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, user, access, signOut, refresh } = useSession()
  const { toast } = useToast()
  const pathname = usePathname()
  const router = useRouter()
  const [railOpen, setRailOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const klipUrl = process.env.NEXT_PUBLIC_KLIP_URL

  const key = navKeyForPath(pathname)
  const allowed = key ? access[key] : false

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login')
    else if (status === 'signedIn' && !allowed) router.replace(homePath(access) || '/no-access')
  }, [status, allowed, access, router])

  useEffect(() => setRailOpen(false), [pathname])

  if (status !== 'signedIn' || !user || !allowed) {
    return (
      <div className="center-page">
        <Spinner />
      </div>
    )
  }

  const main = NAV.filter((n) => !n.admin && access[n.key])
  const admin = NAV.filter((n) => n.admin && access[n.key])
  const item = (n: (typeof NAV)[number]) => {
    const Icon = ICONS[n.key]
    return (
      <Link key={n.key} href={n.href} aria-current={key === n.key ? 'page' : undefined}>
        <Icon aria-hidden />
        {n.label}
      </Link>
    )
  }
  const scope = user.plants?.length ? user.plants.join(', ') : null

  return (
    <>
      <div className="topbar-m">
        <button className="icon-btn" onClick={() => setRailOpen((v) => !v)} aria-label="Open menu" aria-expanded={railOpen}>
          <Menu aria-hidden />
        </button>
        <Brand size={16} />
        <span className="avatar">{initials(user.full_name || user.email)}</span>
      </div>
      <div className="shell">
        <aside className={`rail${railOpen ? ' open' : ''}`}>
          <Link href={homePath(access) || '/'} style={{ textDecoration: 'none' }}>
            <Brand />
          </Link>
          <nav className="nav" aria-label="Main">
            {main.map(item)}
            {admin.length ? <div className="grp">Administration</div> : null}
            {admin.map(item)}
            {klipUrl ? (
              <>
                <div className="grp">Other apps</div>
                <a href={klipUrl}>
                  <ExternalLink aria-hidden />
                  KLIP
                </a>
              </>
            ) : null}
          </nav>
          <div className="me">
            <span className="avatar">{initials(user.full_name || user.email)}</span>
            <div className="who">
              <b title={user.email}>{user.full_name || user.email}</b>
              <span title={scope || undefined}>
                {user.role}
                {scope ? ` · ${scope}` : ''}
              </span>
            </div>
            <button className="icon-btn" onClick={() => setPwOpen(true)} title="Change password" aria-label="Change password">
              <KeyRound aria-hidden />
            </button>
            <button
              className="icon-btn"
              onClick={() => void signOut().then(() => router.replace('/login'))}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut aria-hidden />
            </button>
          </div>
        </aside>
        {railOpen ? <div className="scrim" style={{ zIndex: 44 }} onClick={() => setRailOpen(false)} /> : null}
        <main className="main">{children}</main>
      </div>
      {/* Downstream Hub bug report, a floating button so the name in the sidebar keeps its room. Absent unless the Hub SDK is configured at build time. */}
      {isHubSdkEnabled() ? (
        <button className="bug-fab" onClick={() => hubOpenBugReport()} title="Report a bug" aria-label="Report a bug">
          <Bug aria-hidden />
        </button>
      ) : null}
      {pwOpen || user.is_first_login ? (
        <ChangePasswordModal
          firstLogin={user.is_first_login}
          onClose={() => setPwOpen(false)}
          onDone={() => {
            setPwOpen(false)
            toast('Password changed')
            void refresh()
          }}
        />
      ) : null}
    </>
  )
}
