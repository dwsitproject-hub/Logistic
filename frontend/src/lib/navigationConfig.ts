import type { ComponentType } from 'react'
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
  Database,
  Layers,
  BookOpen,
  Bot,
  Droplets,
  FileCheck,
} from 'lucide-react'

export type NavItem = {
  name: string
  href: string
  icon: ComponentType<{ className?: string }>
  roles: string[]
  permissionKey: string
}

export const NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['ALL'], permissionKey: 'page.dashboard' },
  {
    name: 'Management Dashboard',
    href: '/management-dashboard',
    icon: Presentation,
    roles: ['ALL'],
    permissionKey: 'page.management_dashboard',
  },
  {
    name: 'Contract Performance',
    href: '/contract-performance',
    icon: FileText,
    roles: ['ALL'],
    permissionKey: 'page.contract_performance',
  },
  {
    name: 'Shipping Performance',
    href: '/shipping-performance',
    icon: Package,
    roles: ['ALL'],
    permissionKey: 'page.shipping_performance',
  },
  { name: 'Contracts', href: '/contracts', icon: FileText, roles: ['ALL'], permissionKey: 'page.contracts' },
  { name: 'Shipments', href: '/shipments', icon: Package, roles: ['ALL'], permissionKey: 'page.shipments' },
  { name: 'Trucking', href: '/trucking', icon: Truck, roles: ['ALL'], permissionKey: 'page.trucking' },
  { name: 'Oil Loss', href: '/oil-loss', icon: Droplets, roles: ['ALL'], permissionKey: 'page.oil_loss' },
  {
    name: 'Commercial Documents',
    href: '/commercial-documents',
    icon: FileCheck,
    roles: ['ALL'],
    permissionKey: 'page.commercial_documents',
  },
  { name: 'Claim Mutu', href: '/claim-mutu', icon: Truck, roles: ['ALL'], permissionKey: 'page.claim_mutu' },
  { name: 'Claim Susut', href: '/claim-susut', icon: Truck, roles: ['ALL'], permissionKey: 'page.claim_susut' },
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
    name: 'Master Port',
    href: '/master-loading-port',
    icon: Layers,
    roles: ['ALL'],
    permissionKey: 'page.master_loading_ports',
  },
  { name: 'Master Plant', href: '/master-plant', icon: Layers, roles: ['ALL'], permissionKey: 'page.master_plants' },
  {
    name: 'Finance',
    href: '/finance',
    icon: DollarSign,
    roles: ['FINANCE', 'MANAGEMENT', 'ADMIN'],
    permissionKey: 'page.finance',
  },
  { name: 'KLIP Agent AI', href: '/klip-agent-ai', icon: Bot, roles: ['ALL'], permissionKey: 'page.klip_agent_ai' },
  { name: 'Documents', href: '/documents', icon: FolderOpen, roles: ['ALL'], permissionKey: 'page.documents' },
  { name: 'SAP Data', href: '/sap-imports', icon: Database, roles: ['ALL'], permissionKey: 'page.sap' },
  { name: 'Users', href: '/users', icon: Users, roles: ['ALL'], permissionKey: 'page.users' },
  { name: 'Audit Logs', href: '/audit', icon: Settings, roles: ['ADMIN', 'SUPPORT'], permissionKey: 'page.audit' },
]
