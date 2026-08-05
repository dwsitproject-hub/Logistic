'use client'

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from './ui/button'
import { TooltipProvider } from './ui/tooltip'
import { AppTourProvider, useAppTour } from './AppTourProvider'
import { PageActivityFab } from './PageActivityFab'
import { UserActivityTracker } from './UserActivityTracker'
import { LogOut, Menu, X, BookOpen } from 'lucide-react'
import {
  PermissionsProvider,
  clearPermissionsCache,
  usePermissions,
} from '@/components/PermissionsContext'
import { NAV_ITEMS, type NavItem } from '@/lib/navigationConfig'
import { filterNavigationItems, isPathAccessible } from '@/lib/navigationAccess'
import { clearClientDataCache } from '@/lib/clientDataCache'
import { fetchCurrentUser, logoutSession, clearLocalAuth, readUserLocally } from '@/lib/authSession'
import { prefetchNavigationPage } from '@/lib/pagePrefetch'

type UserLite = {
  id?: string
  full_name?: string
  role?: string
}

function LayoutChrome({
  children,
  user,
  pathname,
  navigation,
  filteredNavigation,
  sidebarNavigationLoading,
  sidebarOpen,
  setSidebarOpen,
  handleLogout,
  onNavHover,
}: {
  children: React.ReactNode
  user: UserLite
  pathname: string
  navigation: { name: string; href: string; icon: ComponentType<{ className?: string }>; roles: string[] }[]
  filteredNavigation: { name: string; href: string; icon: ComponentType<{ className?: string }>; roles: string[] }[]
  sidebarNavigationLoading?: boolean
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean | ((p: boolean) => boolean)) => void
  handleLogout: () => void
  onNavHover: (href: string) => void
}) {
  const { startTour } = useAppTour()
  const pageTitle = navigation.find((item) => item.href === pathname)?.name || 'KLIP'

  return (
    <div className="flex h-screen bg-gray-100">
      <aside
        data-tour="tour-sidebar"
        className={`${
          sidebarOpen ? 'w-52' : 'w-16'
        } bg-white border-r border-gray-200 transition-all duration-300 ease-in-out shrink-0 flex flex-col overflow-hidden`}
      >
        <div className="flex h-14 items-center justify-between gap-1 border-b border-gray-200 px-3 shrink-0">
          {sidebarOpen && <h1 className="text-xl font-bold text-primary leading-none">KLIP</h1>}
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {sidebarNavigationLoading
            ? Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={`nav-skeleton-${index}`}
                  className={`rounded-lg bg-gray-100 animate-pulse ${sidebarOpen ? 'h-9' : 'h-9 w-9'}`}
                  aria-hidden
                />
              ))
            : filteredNavigation.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                prefetch={true}
                onMouseEnter={() => onNavHover(item.href)}
                className={`flex items-start gap-2 px-2.5 py-2 rounded-lg text-sm leading-snug transition-colors ${
                  isActive ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                {sidebarOpen && (
                  <span className="min-w-0 whitespace-normal break-words">{item.name}</span>
                )}
              </Link>
            )
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
        <header data-tour="tour-header" className="flex h-14 shrink-0 items-center border-b border-gray-200 bg-white px-6">
          <div className="flex w-full min-w-0 items-center justify-between gap-4">
            <h2 className="truncate text-xl font-semibold leading-none text-gray-800">{pageTitle}</h2>
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => startTour()}
                className="hidden sm:inline-flex"
              >
                <BookOpen className="h-4 w-4 sm:mr-2" />
                <span className="hidden md:inline">App tour</span>
              </Button>
              <div className="text-right max-w-[140px] sm:max-w-none">
                <p className="text-sm font-medium text-gray-900">{user.full_name}</p>
                <p className="text-xs text-gray-500">{user.role}</p>
              </div>
              <Button variant="outline" size="icon" onClick={handleLogout} title="Log out">
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </header>

        <main data-tour="tour-main" className="flex-1 overflow-y-auto p-6 relative">
          {children}
        </main>

        <PageActivityFab />
        <UserActivityTracker />
      </div>
    </div>
  )
}

function LayoutWithPermissions({
  user,
  children,
}: {
  user: UserLite
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const perms = usePermissions()

  const handleLogout = () => {
    void (async () => {
      clearClientDataCache()
      clearPermissionsCache()
      await logoutSession()
      router.push('/login')
    })()
  }

  const handleNavHover = (href: string) => {
    prefetchNavigationPage(href)
  }

  const filteredNavigation = useMemo(
    () => filterNavigationItems(NAV_ITEMS, user.role, perms),
    [user.role, perms.byKey, perms.loaded],
  )

  const lastSidebarNavigationRef = useRef<NavItem[]>([])
  const sidebarNavigation = useMemo(() => {
    if (filteredNavigation.length > 0) {
      lastSidebarNavigationRef.current = filteredNavigation
      return filteredNavigation
    }
    return lastSidebarNavigationRef.current
  }, [filteredNavigation])

  const sidebarNavigationLoading = !perms.loaded && sidebarNavigation.length === 0

  useEffect(() => {
    if (!perms.loaded) return

    const allowed = filterNavigationItems(NAV_ITEMS, user.role, perms)
    if (allowed.length === 0) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      router.replace('/login?error=no_access')
      return
    }

    const firstRoute = allowed[0].href
    if (!isPathAccessible(pathname, allowed)) {
      router.replace(firstRoute)
    }
  }, [perms.loaded, perms.byKey, pathname, user.role, router])

  return (
    <TooltipProvider delayDuration={200}>
      <AppTourProvider userId={user.id ?? null}>
        <LayoutChrome
          user={user}
          pathname={pathname}
          navigation={NAV_ITEMS}
          filteredNavigation={sidebarNavigation}
          sidebarNavigationLoading={sidebarNavigationLoading}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          handleLogout={handleLogout}
          onNavHover={handleNavHover}
        >
          {children}
        </LayoutChrome>
      </AppTourProvider>
    </TooltipProvider>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  // Hydrate from localStorage on client remount so route changes keep the shell visible
  // while page content shows its own spinners (avoid full-screen blank "Loading...").
  const [user, setUser] = useState<UserLite | null>(() => {
    if (typeof window === 'undefined') return null
    return readUserLocally()
  })

  useEffect(() => {
    void (async () => {
      const sessionUser = await fetchCurrentUser()
      if (sessionUser) {
        setUser(sessionUser)
        return
      }
      const stored = readUserLocally()
      if (stored) {
        setUser(stored)
        return
      }
      clearLocalAuth()
      router.replace('/login')
    })()
  }, [router])

  if (!user) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  return (
    <PermissionsProvider userRole={user.role} userId={user.id}>
      <LayoutWithPermissions user={user}>{children}</LayoutWithPermissions>
    </PermissionsProvider>
  )
}
