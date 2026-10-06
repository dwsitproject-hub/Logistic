import { describe, expect, it } from 'vitest'
import { jettyStatusLabel, jettyStatusTooltip } from './jettyStatus'

describe('Jetty Status label', () => {
  it('shows what the server sends, and Not Sent for none', () => {
    expect(jettyStatusLabel({ jetty_status: 'Allocated' })).toBe('Allocated')
    expect(jettyStatusLabel({ jetty_status: 'Completed (Hose Off)' })).toBe('Completed (Hose Off)')
    expect(jettyStatusLabel({ jetty_status: '  ' })).toBe('Not Sent')
    expect(jettyStatusLabel(null)).toBe('Not Sent')
  })

  it('names the Hose Off date in the tooltip, next to the berth', () => {
    const tip = jettyStatusTooltip({
      jetty_status: 'Completed (Hose Off)',
      jetty_name: 'Jetty 2B',
      jetty_hose_off_at: '2026-10-05T10:00:00Z',
    })
    expect(tip).toContain('Jetty: Jetty 2B')
    expect(tip).toContain('Hose Off: 05 Oct 2026')
  })
})
