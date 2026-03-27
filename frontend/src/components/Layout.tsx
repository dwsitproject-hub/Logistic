'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from './ui/button'
import { TooltipProvider } from './ui/tooltip'
import { AppTourProvider, useAppTour } from './AppTourProvider'
import { PageActivityFab } from './PageActivityFab'
import {
  LayoutDashboard,
  Presentation,
  FileText,
  Package,
  Truck,
  DollarSign,
  FolderOpen,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Database,
  Layers,
  BookOpen,
  Bot,
} from 'lucide-react'
import api from '@/lib/api'

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
  sidebarOpen,
  setSidebarOpen,
  handleLogout,
}: {
  children: React.ReactNode
  user: UserLite
  pathname: string
  navigation: { name: string; href: string; icon: ComponentType<{ className?: string }>; roles: string[] }[]
  filteredNavigation: { name: string; href: string; icon: ComponentType<{ className?: string }>; roles: string[] }[]
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean | ((p: boolean) => boolean)) => void
  handleLogout: () => void
}) {
  const { startTour } = useAppTour()
  const pageTitle = navigation.find((item) => item.href === pathname)?.name || 'KLIP'

  return (
    <div className="flex h-screen bg-gray-100">
      <aside
        data-tour="tour-sidebar"
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-white border-r border-gray-200 transition-all duration-300 ease-in-out shrink-0`}
      >
        <div className="flex items-center justify-between p-4 border-b">
          {sidebarOpen && <h1 className="text-2xl font-bold text-primary">KLIP</h1>}
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        <nav className="p-4 space-y-2">
          {filteredNavigation.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="h-5 w-5" />
                {sidebarOpen && <span>{item.name}</span>}
              </Link>
            )
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
        <header data-tour="tour-header" className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-gray-800 truncate">{pageTitle}</h2>
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
      </div>
    </div>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<UserLite | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [permByKey, setPermByKey] = useState<Record<string, { canView?: boolean }> | undefined>(undefined)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')

    if (!token || !userData) {
      router.push('/login')
    } else {
      setUser(JSON.parse(userData))
    }
  }, [router])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    api
      .get('/roles/my-permissions')
      .then((res) => {
        if (!cancelled) setPermByKey(res.data?.data?.permissions ?? {})
      })
      .catch(() => {
        if (!cancelled) setPermByKey(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    router.push('/login')
  }

  const navigation: {
    name: string
    href: string
    icon: ComponentType<{ className?: string }>
    roles: string[]
    permissionKey?: string
  }[] = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['ALL'], permissionKey: 'page.dashboard' },
    {
      name: 'Management Dashboard',
      href: '/management-dashboard',
      icon: Presentation,
      roles: ['ALL'],
      permissionKey: 'page.management_dashboard',
    },
    { name: 'Contracts', href: '/contracts', icon: FileText, roles: ['ALL'] },
    { name: 'Shipments', href: '/shipments', icon: Package, roles: ['ALL'] },
    { name: 'Trucking', href: '/trucking', icon: Truck, roles: ['ALL'] },
    { name: 'Suppliers Dashboard', href: '/customer-360', icon: Users, roles: ['ALL'] },
    { name: 'Suppliers', href: '/supplier', icon: Users, roles: ['ALL'] },
    { name: 'Customer 360', href: '/customer-360-company', icon: Users, roles: ['ALL'] },
    { name: 'Master Product Configuration', href: '/master-product-configuration', icon: Layers, roles: ['ALL'] },
    { name: 'Master Vessel', href: '/master-vessel', icon: Layers, roles: ['ALL'] },
    { name: 'Master Loading Port', href: '/master-loading-port', icon: Layers, roles: ['ALL'] },
    { name: 'Finance', href: '/finance', icon: DollarSign, roles: ['FINANCE', 'MANAGEMENT', 'ADMIN'] },
    { name: 'KLIP Agent AI', href: '/klip-agent-ai', icon: Bot, roles: ['ALL'] },
    { name: 'Documents', href: '/documents', icon: FolderOpen, roles: ['ALL'] },
    { name: 'SAP Data', href: '/sap-imports', icon: Database, roles: ['ADMIN', 'SUPPORT', 'MANAGEMENT'] },
    { name: 'Users', href: '/users', icon: Users, roles: ['ALL'] },
    { name: 'Audit Logs', href: '/audit', icon: Settings, roles: ['ADMIN', 'SUPPORT'] },
  ]

  const filteredNavigation = navigation.filter((item) => {
    const roleOk = item.roles.includes('ALL') || (user?.role != null && item.roles.includes(user.role))
    if (!roleOk) return false
    if (item.permissionKey) {
      if (permByKey === undefined) return true
      return !!permByKey[item.permissionKey]?.canView
    }
    return true
  })

  if (!user) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  return (
    <TooltipProvider delayDuration={200}>
      <AppTourProvider userId={user.id ?? null}>
        <LayoutChrome
          user={user}
          pathname={pathname}
          navigation={navigation}
          filteredNavigation={filteredNavigation}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          handleLogout={handleLogout}
        >
          {children}
        </LayoutChrome>
      </AppTourProvider>
    </TooltipProvider>
  )
}
