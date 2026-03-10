'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from './ui/button'
import {
  LayoutDashboard,
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
} from 'lucide-react'

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<any>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    
    if (!token || !userData) {
      router.push('/login')
    } else {
      setUser(JSON.parse(userData))
    }
  }, [router])

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    router.push('/login')
  }

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['ALL'] },
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
    { name: 'Documents', href: '/documents', icon: FolderOpen, roles: ['ALL'] },
    { name: 'SAP Data', href: '/sap-imports', icon: Database, roles: ['ADMIN', 'SUPPORT', 'MANAGEMENT'] },
    { name: 'Users', href: '/users', icon: Users, roles: ['ALL'] },
    { name: 'Audit Logs', href: '/audit', icon: Settings, roles: ['ADMIN', 'SUPPORT'] },
  ]

  const filteredNavigation = navigation.filter(
    (item) => item.roles.includes('ALL') || item.roles.includes(user?.role)
  )

  if (!user) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-white border-r border-gray-200 transition-all duration-300 ease-in-out`}
      >
        <div className="flex items-center justify-between p-4 border-b">
          {sidebarOpen && <h1 className="text-2xl font-bold text-primary">KLIP</h1>}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
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
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="h-5 w-5" />
                {sidebarOpen && <span>{item.name}</span>}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-800">
              {navigation.find((item) => item.href === pathname)?.name || 'KLIP'}
            </h2>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{user.full_name}</p>
                <p className="text-xs text-gray-500">{user.role}</p>
              </div>
              <Button variant="outline" size="icon" onClick={handleLogout}>
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}

