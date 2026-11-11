'use client'

import { BarChart3, BookOpen, ExternalLink, FileSpreadsheet, FileText, History, KeyRound, LogOut, Menu, MessageSquareWarning, ShieldCheck, UserSearch, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { GuidePrompt, GuideViewer } from '@/components/GuidePrompt'
import { Brand, Spinner, useToast } from '@/components/ui'
import { apiJson } from '@/lib/api'
import { NAV, homePath, navKeyForPath, type NavKey } from '@/lib/access'
import { initials, plantLabel } from '@/lib/format'
import { GUIDE_SEEN_KEY, GUIDE_URL, GUIDE_VERSION } from '@/lib/guide'
import { hubOpenBugReport, isHubSdkEnabled } from '@/lib/hubSdk'
import { useSession } from '@/lib/session'

const ICONS: Record<NavKey, typeof FileText> = {
  dashboard: BarChart3,
  documents: FileText,
  users: Users,
  roles: ShieldCheck,
  audit: History,
  me2n: FileSpreadsheet,
  sapUsers: UserSearch,
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, user, access, signOut, refresh } = useSession()
  const { toast } = useToast()
  const pathname = usePathname()
  const router = useRouter()
  const [railOpen, setRailOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [guideClosed, setGuideClosed] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  // The "New" mark on User guide: shown until this browser has opened (or downloaded) the current guide version.
  // 'loading' until localStorage is read, so the mark does not flash for someone who has already seen it.
  const [guideSeen, setGuideSeen] = useState<string>('loading')
  useEffect(() => {
    try {
      setGuideSeen(localStorage.getItem(GUIDE_SEEN_KEY) || '')
    } catch {
      setGuideSeen('')
    }
  }, [])
  const markGuideSeen = () => {
    setGuideSeen(GUIDE_VERSION)
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, GUIDE_VERSION)
    } catch {
      /* ignore */
    }
  }
  const klipUrl = process.env.NEXT_PUBLIC_KLIP_URL

  const key = navKeyForPath(pathname)
  const allowed = key ? access[key] : false

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login')
    else if (status === 'signedIn' && !allowed) router.replace(homePath(access) || '/no-access')
  }, [status, allowed, access, router])

  useEffect(() => setRailOpen(false), [pathname])

  // The user guide prompt: once, at the first sign-in. It waits for the forced password change, and the server is told as soon as it
  // is shown, so a later sign-in (on any device) does not show it again. `=== false`: an older backend that does not send the flag never prompts.
  const showGuide = status === 'signedIn' && user?.commdocs_guide_seen === false && !user.is_first_login && !pwOpen && !guideClosed
  useEffect(() => {
    if (showGuide) void apiJson('/auth/commdocs-guide-seen', { method: 'POST' }).catch(() => undefined)
  }, [showGuide])

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
  const scope = user.plants?.length ? user.plants.map(plantLabel).join(', ') : null

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
            <div className="grp">Help</div>
            {/* Opens the guide inside the app; a middle-click or "open in new tab" still gets the PDF itself. */}
            <a
              href={GUIDE_URL}
              onClick={(e) => {
                e.preventDefault()
                setGuideOpen(true)
                markGuideSeen()
                setRailOpen(false)
              }}
            >
              <BookOpen aria-hidden />
              User guide <span className="hint">{GUIDE_VERSION}</span>
              {guideSeen !== 'loading' && guideSeen !== GUIDE_VERSION ? <span className="new-tag">New</span> : null}
            </a>
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
        <button
          className="bug-fab"
          onClick={() => hubOpenBugReport()}
          title="Something not working or looking wrong? Tell us and we will look into it."
          aria-label="Report a problem"
        >
          <MessageSquareWarning aria-hidden />
          <span>Report a problem</span>
        </button>
      ) : null}
      {guideOpen ? <GuideViewer onClose={() => setGuideOpen(false)} /> : null}
      {showGuide ? <GuidePrompt onClose={() => setGuideClosed(true)} onDownload={markGuideSeen} /> : null}
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
