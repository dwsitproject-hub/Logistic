import { describe, expect, it } from 'vitest'
import { jettySendStateTooltip, jettyStatusLabel, jettyStatusTooltip } from './jettyStatus'

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

describe('Jetty Status tells "never tried" from "tried and failed" from "held back"', () => {
  it('keeps Not Sent for an STO KLIP has not tried, and says Send Failed / On Hold when it did', () => {
    expect(jettyStatusLabel({ jetty_status: null, jetty_send_state: null })).toBe('Not Sent')
    expect(jettyStatusLabel({ jetty_send_state: 'FAILED' })).toBe('Send Failed')
    expect(jettyStatusLabel({ jetty_send_state: 'HELD' })).toBe('On Hold')
    expect(jettyStatusLabel({ jetty_send_state: 'failed' })).toBe('Send Failed')
  })

  it('JPS status still wins: an instruction JPS holds is where the STO stands, whatever else was recorded', () => {
    expect(jettyStatusLabel({ jetty_status: 'Pending', jetty_send_state: 'FAILED' })).toBe('Pending')
  })

  it('the hover text carries what JPS answered or what is missing, and the time', () => {
    const failed = jettyStatusTooltip({
      jetty_send_state: 'FAILED',
      jetty_send_error: 'VALIDATION_ERROR: vessel_name: Master vessel LOA is missing',
      jetty_send_at: '2026-10-27T01:50:00Z',
    })
    expect(failed).toContain('JPS did not accept it')
    expect(failed).toContain('Master vessel LOA is missing')
    expect(failed).toContain('Last attempt:')

    const held = jettyStatusTooltip({ jetty_send_state: 'HELD', jetty_send_error: 'product POME has no JPS cargo_hub_code' })
    expect(held).toContain('holding this STO back')
    expect(held).toContain('POME')
  })

  it('has no hover text for Not Sent', () => {
    expect(jettyStatusTooltip({ jetty_status: null })).toBeUndefined()
    expect(jettySendStateTooltip(null)).toBeUndefined()
  })
})
