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
import {
  PermissionsProvider,
  usePermissions,
  canViewPermission,
  isAdminRole,
} from '@/components/PermissionsContext'

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

const NAV_ITEMS: {
  name: string
  href: string
  icon: ComponentType<{ className?: string }>
  roles: string[]
  permissionKey: string
}[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['ALL'], permissionKey: 'page.dashboard' },
  {
    name: 'Management Dashboard',
    href: '/management-dashboard',
    icon: Presentation,
    roles: ['ALL'],
    permissionKey: 'page.management_dashboard',
  },
  { name: 'Contracts', href: '/contracts', icon: FileText, roles: ['ALL'], permissionKey: 'page.contracts' },
  { name: 'Shipments', href: '/shipments', icon: Package, roles: ['ALL'], permissionKey: 'page.shipments' },
  { name: 'Trucking', href: '/trucking', icon: Truck, roles: ['ALL'], permissionKey: 'page.trucking' },
  { name: 'Suppliers Dashboard', href: '/customer-360', icon: Users, roles: ['ALL'], permissionKey: 'page.customer_360' },
  { name: 'Suppliers', href: '/supplier', icon: Users, roles: ['ALL'], permissionKey: 'page.suppliers' },
  {
    name: 'Customer 360',
    href: '/customer-360-company',
    icon: Users,
    roles: ['ALL'],
    permissionKey: 'page.customer_360_company',
  },
  {
    name: 'Master Product Configuration',
    href: '/master-product-configuration',
    icon: Layers,
    roles: ['ALL'],
    permissionKey: 'page.master_product_configuration',
  },
  { name: 'Master Vessel', href: '/master-vessel', icon: Layers, roles: ['ALL'], permissionKey: 'page.master_vessels' },
  {
    name: 'Master Loading Port',
    href: '/master-loading-port',
    icon: Layers,
    roles: ['ALL'],
    permissionKey: 'page.master_loading_ports',
  },
  { name: 'Finance', href: '/finance', icon: DollarSign, roles: ['FINANCE', 'MANAGEMENT', 'ADMIN'], permissionKey: 'page.finance' },
  { name: 'KLIP Agent AI', href: '/klip-agent-ai', icon: Bot, roles: ['ALL'], permissionKey: 'page.klip_agent_ai' },
  { name: 'Documents', href: '/documents', icon: FolderOpen, roles: ['ALL'], permissionKey: 'page.documents' },
  { name: 'SAP Data', href: '/sap-imports', icon: Database, roles: ['ADMIN', 'SUPPORT', 'MANAGEMENT'], permissionKey: 'page.sap' },
  { name: 'Users', href: '/users', icon: Users, roles: ['ALL'], permissionKey: 'page.users' },
  { name: 'Audit Logs', href: '/audit', icon: Settings, roles: ['ADMIN', 'SUPPORT'], permissionKey: 'page.audit' },
]

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
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    router.push('/login')
  }

  const filteredNavigation = NAV_ITEMS.filter((item) => {
    const roleOk = item.roles.includes('ALL') || (user.role != null && item.roles.includes(user.role))
    if (!roleOk) return false
    if (isAdminRole(user.role)) return true
    return canViewPermission(perms, item.permissionKey)
  })

  return (
    <TooltipProvider delayDuration={200}>
      <AppTourProvider userId={user.id ?? null}>
        <LayoutChrome
          user={user}
          pathname={pathname}
          navigation={NAV_ITEMS}
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

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<UserLite | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')

    if (!token || !userData) {
      router.push('/login')
    } else {
      setUser(JSON.parse(userData))
    }
  }, [router])

  if (!user) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  return (
    <PermissionsProvider userRole={user.role}>
      <LayoutWithPermissions user={user}>{children}</LayoutWithPermissions>
    </PermissionsProvider>
  )
}
