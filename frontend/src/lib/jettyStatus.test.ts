import { describe, expect, it } from 'vitest'
import { jettyCanRefresh, jettySendStateTooltip, jettyStatusLabel, jettyStatusTooltip, jettySubmitMode } from './jettyStatus'

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
      jetty_send_error: 'VALIDATION_ERROR: vessel_name: Master LOA must be a positive number',
      jetty_send_at: '2026-10-27T01:50:00Z',
    })
    expect(failed).toContain('JPS did not accept it')
    expect(failed).toContain('Master LOA must be a positive number')
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

describe('Submit to Jetty button: what JPS holds decides what it does', () => {
  it('Rejected and Deleted can be resubmitted', () => {
    expect(jettySubmitMode({ jetty_status: 'Rejected' })).toBe('resubmit')
    expect(jettySubmitMode({ jetty_status: 'Deleted' })).toBe('resubmit')
  })

  it('every status JPS holds locks it, including the stage after Hose Off and Sailed', () => {
    for (const status of ['Pending', 'Approved', 'Allocated', 'Berthed', 'Start Cargo', 'Cargo Done', 'Completed (Hose Off)', 'Sailed Off', 'Sailed']) {
      expect(jettySubmitMode({ jetty_status: status })).toBe('locked')
    }
  })

  it('a status KLIP does not know yet locks too (the backend refuses it as well)', () => {
    expect(jettySubmitMode({ jetty_status: 'Something New' })).toBe('locked')
  })

  it('nothing at JPS (Not Sent, Send Failed, On Hold) is the plain Submit to Jetty', () => {
    expect(jettySubmitMode(null)).toBe('submit')
    expect(jettySubmitMode({ jetty_status: null })).toBe('submit')
    expect(jettySubmitMode({ jetty_status: '  ', jetty_send_state: 'FAILED' })).toBe('submit')
    expect(jettySubmitMode({ jetty_status: null, jetty_send_state: 'HELD' })).toBe('submit')
  })
})

describe('Refresh from JPS: only where the status can still move', () => {
  it('offered for the statuses the poller keeps polling', () => {
    for (const status of ['Pending', 'Approved', 'Allocated', 'Berthed', 'Start Cargo', 'Cargo Done', 'Completed (Hose Off)']) {
      expect(jettyCanRefresh({ jetty_status: status })).toBe(true)
    }
  })

  it('not offered for a final status, or when nothing is at JPS', () => {
    for (const status of ['Sailed Off', 'Sailed', 'Rejected', 'Deleted']) expect(jettyCanRefresh({ jetty_status: status })).toBe(false)
    expect(jettyCanRefresh(null)).toBe(false)
    expect(jettyCanRefresh({ jetty_status: null, jetty_send_state: 'FAILED' })).toBe(false)
  })
})
