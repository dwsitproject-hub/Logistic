import { describe, expect, it } from 'vitest'
import { isHiddenNavHref, isHiddenPermissionKey } from './hiddenFeatures'
import { ALL_NAV_ITEMS, NAV_ITEMS } from './navigationConfig'

describe('hidden features', () => {
  it('removes exactly the six unused pages from the sidebar', () => {
    const hidden = ALL_NAV_ITEMS.filter((item) => !NAV_ITEMS.includes(item)).map((item) => item.name)
    // The two Commercial pages leave through their own switch (commdocsApp), which is off in the test environment.
    expect(hidden.sort()).toEqual(['Audit Logs', 'Customer 360', 'Dashboard', 'Finance', 'Management Dashboard', 'Suppliers Dashboard'])
  })

  it('keeps every other page, and the User Activity Log', () => {
    const names = NAV_ITEMS.map((item) => item.name)
    for (const name of ['Contract Performance', 'Shipping Performance', 'Contracts', 'Shipments', 'Trucking', 'Users', 'User Activity Log', 'Logistics Data', 'Integrations']) {
      expect(names).toContain(name)
    }
    expect(NAV_ITEMS.some((item) => isHiddenNavHref(item.href))).toBe(false)
  })

  it('hides the permission rows of those pages, the dashboard widgets and the audit / finance data rows', () => {
    for (const key of ['page.dashboard', 'page.management_dashboard', 'page.audit', 'page.customer_360', 'page.customer_360_company', 'page.finance', 'data.audit', 'data.finance', 'dashboard.top_vessels', 'dashboard.alerts']) {
      expect(isHiddenPermissionKey(key)).toBe(true)
    }
  })

  it('leaves the other permission rows alone, including the near-miss names', () => {
    for (const key of ['page.users', 'page.contracts', 'page.commercial_dashboard', 'page.commercial_documents', 'page.suppliers', 'data.users', 'data.contract_payment_info', 'data.commercial_documents']) {
      expect(isHiddenPermissionKey(key)).toBe(false)
    }
    expect(isHiddenNavHref('/customer-360')).toBe(true)
    expect(isHiddenNavHref('/commercial-dashboard')).toBe(false)
  })
})
