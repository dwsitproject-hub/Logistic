import { describe, expect, it } from 'vitest'
import { NAV_GROUP_LABELS, NAV_GROUP_ORDER, NAV_ITEMS } from './navigationConfig'

describe('sidebar groups', () => {
  it('puts Import Data between Operations and Master Data', () => {
    expect(NAV_GROUP_ORDER).toEqual(['performance', 'operations', 'import', 'master', 'system'])
    expect(NAV_GROUP_LABELS.import).toBe('Import Data')
  })

  it('holds Logistics Data, WB Data and Claim Data, and nothing else', () => {
    const names = NAV_ITEMS.filter((item) => item.group === 'import').map((item) => item.name)
    expect(names).toEqual(['Logistics Data', 'WB Data', 'Claim Data'])
  })

  it('no longer lists them under System & Admin', () => {
    const system = NAV_ITEMS.filter((item) => item.group === 'system').map((item) => item.name)
    expect(system).not.toContain('Logistics Data')
    expect(system).not.toContain('Claim Data')
    expect(system).not.toContain('WB Data')
  })

  it('every group in the order has a label', () => {
    for (const group of NAV_GROUP_ORDER) expect(NAV_GROUP_LABELS[group]).toBeTruthy()
  })
})
