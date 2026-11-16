import type { ComponentType } from 'react'
import {
  Activity,
  Anchor,
  BadgeCheck,
  Building,
  Building2,
  DatabaseZap,
  Droplets,
  Factory,
  FileBarChart,
  FileSignature,
  FileSpreadsheet,
  Files,
  Gauge,
  Handshake,
  LayoutGrid,
  MapPinned,
  Orbit,
  Package,
  PackageMinus,
  PieChart,
  PlugZap,
  ScrollText,
  Ship,
  Sparkles,
  Store,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { StitchNavIcons } from '@/components/shared/stitchIcons'
import { withoutMovedPages } from '@/lib/commdocsApp'

export type NavGroup = 'performance' | 'operations' | 'master' | 'system'

export type NavItem = {
  name: string
  href: string
  icon: ComponentType<{ className?: string }>
  roles: string[]
  permissionKey: string
  group?: NavGroup
}

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  performance: 'Performance',
  operations: 'Operations',
  master: 'Master Data',
  system: 'System & Admin',
}

export const NAV_GROUP_ORDER: NavGroup[] = ['performance', 'operations', 'master', 'system']

/** Every menu entry, before the Commercial Documents go-live switch (see lib/commdocsApp.ts). */
export const ALL_NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutGrid, roles: ['ALL'], permissionKey: 'page.dashboard' },
  {
    name: 'Management Dashboard',
    href: '/management-dashboard',
    icon: Gauge,
    roles: ['ALL'],
    permissionKey: 'page.management_dashboard',
  },
  {
    name: 'Contract Performance',
    href: '/contract-performance',
    icon: FileBarChart,
    roles: ['ALL'],
    permissionKey: 'page.contract_performance',
    group: 'performance',
  },
  {
    name: 'Shipping Performance',
    href: '/shipping-performance',
    icon: Ship,
    roles: ['ALL'],
    permissionKey: 'page.shipping_performance',
    group: 'performance',
  },
  { name: 'Oil Loss', href: '/oil-loss', icon: Droplets, roles: ['ALL'], permissionKey: 'page.oil_loss', group: 'performance' },
  { name: 'Shortage Claim', href: '/claim-susut', icon: PackageMinus, roles: ['ALL'], permissionKey: 'page.claim_susut', group: 'performance' },
  { name: 'Quality Claim', href: '/claim-mutu', icon: BadgeCheck, roles: ['ALL'], permissionKey: 'page.claim_mutu', group: 'performance' },
  {
    name: 'Commercial Dashboard',
    href: '/commercial-dashboard',
    icon: PieChart,
    roles: ['ALL'],
    permissionKey: 'page.commercial_dashboard',
    group: 'performance',
  },
  { name: 'Contracts', href: '/contracts', icon: FileSignature, roles: ['ALL'], permissionKey: 'page.contracts', group: 'operations' },
  { name: 'Shipments', href: '/shipments', icon: Ship, roles: ['ALL'], permissionKey: 'page.shipments', group: 'operations' },
  { name: 'Trucking', href: '/trucking', icon: StitchNavIcons.trucking, roles: ['ALL'], permissionKey: 'page.trucking', group: 'operations' },
  {
    name: 'Commercial Documents',
    href: '/commercial-documents',
    icon: Files,
    roles: ['ALL'],
    permissionKey: 'page.commercial_documents',
    group: 'operations',
  },
  { name: 'Master Company (Internal)', href: '/master-company', icon: Building2, roles: ['ALL'], permissionKey: 'page.master_companies', group: 'master' },
  { name: 'Master Site', href: '/master-site', icon: MapPinned, roles: ['ALL'], permissionKey: 'page.master_sites', group: 'master' },
  { name: 'Master Plant', href: '/master-plant', icon: Factory, roles: ['ALL'], permissionKey: 'page.master_plants', group: 'master' },
  {
    name: 'Master Port',
    href: '/master-loading-port',
    icon: Anchor,
    roles: ['ALL'],
    permissionKey: 'page.master_loading_ports',
    group: 'master',
  },
  { name: 'Master Vessel', href: '/master-vessel', icon: Ship, roles: ['ALL'], permissionKey: 'page.master_vessels', group: 'master' },
  { name: 'Master Incoterm', href: '/master-incoterm', icon: Handshake, roles: ['ALL'], permissionKey: 'page.master_incoterms', group: 'master' },
  {
    name: 'Master Product',
    href: '/master-product-configuration',
    icon: Package,
    roles: ['ALL'],
    permissionKey: 'page.master_product_configuration',
    group: 'master',
  },
  { name: 'Master Company (External)', href: '/master-company-ext', icon: Building, roles: ['ALL'], permissionKey: 'page.suppliers', group: 'master' },
  { name: 'Users', href: '/users', icon: UsersRound, roles: ['ALL'], permissionKey: 'page.users', group: 'system' },
  { name: 'Logistics Data', href: '/sap-imports', icon: DatabaseZap, roles: ['ALL'], permissionKey: 'page.sap', group: 'system' },
  { name: 'Claim Data', href: '/claim-data', icon: FileSpreadsheet, roles: ['ADMIN'], permissionKey: 'page.claim_data', group: 'system' },
  // Holds the credentials KLIP uses on other systems - ADMIN only, and no read-only tier (migration 189).
  {
    name: 'Integrations',
    href: '/integrations',
    icon: PlugZap,
    roles: ['ADMIN'],
    permissionKey: 'page.integrations',
    group: 'system',
  },
  {
    name: 'Audit Logs',
    href: '/audit',
    icon: ScrollText,
    roles: ['ADMIN', 'SUPPORT', 'ADMIN_SUPPORT'],
    permissionKey: 'page.audit',
    group: 'system',
  },
  {
    name: 'AI Agent Activity Log',
    href: '/ai-klip-agent-activity',
    icon: Activity,
    roles: ['ADMIN', 'SUPPORT', 'ADMIN_SUPPORT', 'MANAGEMENT', 'LOGISTICS'],
    permissionKey: 'page.ai_klip_agent_activity',
    group: 'system',
  },
  { name: 'Suppliers Dashboard', href: '/customer-360', icon: Store, roles: ['ALL'], permissionKey: 'page.customer_360', group: 'system' },
  {
    name: 'Customer 360',
    href: '/customer-360-company',
    icon: Orbit,
    roles: ['ALL'],
    permissionKey: 'page.customer_360_company',
    group: 'system',
  },
  {
    name: 'Finance',
    href: '/finance',
    icon: Wallet,
    roles: ['FINANCE', 'MANAGEMENT', 'ADMIN'],
    permissionKey: 'page.finance',
    group: 'system',
  },
  { name: 'KLIP Agent AI', href: '/klip-agent-ai', icon: Sparkles, roles: ['ALL'], permissionKey: 'page.klip_agent_ai', group: 'system' },
]

/** What KLIP shows: without Commercial Documents / Commercial Dashboard once they live in their own app. */
export const NAV_ITEMS: NavItem[] = withoutMovedPages(ALL_NAV_ITEMS)
