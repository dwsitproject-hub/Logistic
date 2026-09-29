import type { ComponentType } from 'react'
import {
  LayoutDashboard,
  Presentation,
  DollarSign,
  Users,
  Bot,
  Plug,
  Ship,
} from 'lucide-react'
import { StitchNavIcons } from '@/components/shared/stitchIcons'

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
    icon: StitchNavIcons.contractPerformance,
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
  { name: 'Oil Loss', href: '/oil-loss', icon: StitchNavIcons.oilLoss, roles: ['ALL'], permissionKey: 'page.oil_loss', group: 'performance' },
  { name: 'Shortage Claim', href: '/claim-susut', icon: StitchNavIcons.claimSusut, roles: ['ALL'], permissionKey: 'page.claim_susut', group: 'performance' },
  { name: 'Quality Claim', href: '/claim-mutu', icon: StitchNavIcons.claimMutu, roles: ['ALL'], permissionKey: 'page.claim_mutu', group: 'performance' },
  { name: 'Contracts', href: '/contracts', icon: StitchNavIcons.contracts, roles: ['ALL'], permissionKey: 'page.contracts', group: 'operations' },
  { name: 'Shipments', href: '/shipments', icon: Ship, roles: ['ALL'], permissionKey: 'page.shipments', group: 'operations' },
  { name: 'Trucking', href: '/trucking', icon: StitchNavIcons.trucking, roles: ['ALL'], permissionKey: 'page.trucking', group: 'operations' },
  {
    name: 'Commercial Documents',
    href: '/commercial-documents',
    icon: StitchNavIcons.commercialDocuments,
    roles: ['ALL'],
    permissionKey: 'page.commercial_documents',
    group: 'operations',
  },
  { name: 'Master Vessel', href: '/master-vessel', icon: Ship, roles: ['ALL'], permissionKey: 'page.master_vessels', group: 'master' },
  {
    name: 'Master Product',
    href: '/master-product-configuration',
    icon: StitchNavIcons.masterData,
    roles: ['ALL'],
    permissionKey: 'page.master_product_configuration',
    group: 'master',
  },
  {
    name: 'Master Port',
    href: '/master-loading-port',
    icon: StitchNavIcons.masterPort,
    roles: ['ALL'],
    permissionKey: 'page.master_loading_ports',
    group: 'master',
  },
  { name: 'Master Company (Internal)', href: '/master-plant', icon: StitchNavIcons.masterPlant, roles: ['ALL'], permissionKey: 'page.master_plants', group: 'master' },
  { name: 'Master Company (Ext)', href: '/master-company-ext', icon: Users, roles: ['ALL'], permissionKey: 'page.suppliers', group: 'master' },
  { name: 'Master Incoterm', href: '/master-incoterm', icon: StitchNavIcons.masterData, roles: ['ALL'], permissionKey: 'page.master_product_configuration', group: 'master' },
  { name: 'Master Truck Transporter', href: '/master-truck-transporter', icon: StitchNavIcons.trucking, roles: ['ALL'], permissionKey: 'page.master_product_configuration', group: 'master' },
  { name: 'SAP Data', href: '/sap-imports', icon: StitchNavIcons.sapData, roles: ['ALL'], permissionKey: 'page.sap', group: 'system' },
  { name: 'Suppliers Dashboard', href: '/customer-360', icon: Users, roles: ['ALL'], permissionKey: 'page.customer_360', group: 'system' },
  {
    name: 'Customer 360',
    href: '/customer-360-company',
    icon: Users,
    roles: ['ALL'],
    permissionKey: 'page.customer_360_company',
    group: 'system',
  },
  {
    name: 'Finance',
    href: '/finance',
    icon: DollarSign,
    roles: ['FINANCE', 'MANAGEMENT', 'ADMIN'],
    permissionKey: 'page.finance',
    group: 'system',
  },
  { name: 'KLIP Agent AI', href: '/klip-agent-ai', icon: Bot, roles: ['ALL'], permissionKey: 'page.klip_agent_ai', group: 'system' },
  {
    name: 'AI Agent Activity Log',
    href: '/ai-klip-agent-activity',
    icon: StitchNavIcons.activity,
    roles: ['ADMIN', 'SUPPORT', 'ADMIN_SUPPORT', 'MANAGEMENT', 'LOGISTICS'],
    permissionKey: 'page.ai_klip_agent_activity',
    group: 'system',
  },
  { name: 'Documents', href: '/documents', icon: StitchNavIcons.documents, roles: ['ALL'], permissionKey: 'page.documents', group: 'system' },
  { name: 'Users', href: '/users', icon: StitchNavIcons.users, roles: ['ALL'], permissionKey: 'page.users', group: 'system' },
  {
    name: 'Audit Logs',
    href: '/audit',
    icon: StitchNavIcons.audit,
    roles: ['ADMIN', 'SUPPORT', 'ADMIN_SUPPORT'],
    permissionKey: 'page.audit',
    group: 'system',
  },
  // Holds the credentials KLIP uses on other systems - ADMIN only, and no read-only tier (migration 189).
  {
    name: 'Integrations',
    href: '/integrations',
    icon: Plug,
    roles: ['ADMIN'],
    permissionKey: 'page.integrations',
    group: 'system',
  },
]
