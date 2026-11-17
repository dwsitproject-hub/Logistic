/**
 * Features that are not in use yet and are hidden on purpose (decision 2026-11-17): Dashboard, Management Dashboard, Audit Logs, Suppliers Dashboard, Customer 360 and Finance.
 *
 * Hidden means: no sidebar entry, no address that opens (the Layout sends a user to their first accessible page when the address is not in the menu), and no row in
 * Manage Roles. Nothing is deleted: the permission rows stay in the database, the Roles page still sends them back unchanged when it saves, and the pages and API routes are
 * untouched. To bring a feature back, remove its entry here.
 */
export const HIDDEN_NAV_HREFS: readonly string[] = [
  '/dashboard',
  '/management-dashboard',
  '/audit',
  '/customer-360',
  '/customer-360-company',
  '/finance',
]

/** The permission rows of those features: the six pages, the Dashboard's widgets (every `dashboard.*`), and the audit and finance data rows. */
export const HIDDEN_PERMISSION_KEYS: readonly string[] = [
  'page.dashboard',
  'page.management_dashboard',
  'page.audit',
  'page.customer_360',
  'page.customer_360_company',
  'page.finance',
  'data.audit',
  'data.finance',
]

export function isHiddenNavHref(href: string): boolean {
  return HIDDEN_NAV_HREFS.includes(href)
}

export function isHiddenPermissionKey(key: string): boolean {
  return HIDDEN_PERMISSION_KEYS.includes(key) || key.startsWith('dashboard.')
}
