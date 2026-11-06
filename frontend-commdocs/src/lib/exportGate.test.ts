import { describe, expect, it } from 'vitest'
import { exportGate } from './exportGate'

describe('export gate', () => {
  it('needs a date range and at least one other filter', () => {
    expect(exportGate({ dateSet: true, others: ['Region/Plant'] }).ok).toBe(true)
    expect(exportGate({ dateSet: true, others: [] }).ok).toBe(false)
    expect(exportGate({ dateSet: false, others: ['Region/Plant', 'Incoterm'] }).ok).toBe(false)
    expect(exportGate({ dateSet: false, others: [] }).ok).toBe(false)
  })
  it('says what is missing', () => {
    expect(exportGate({ dateSet: true, others: [] }).hint).toMatch(/one more filter/)
    expect(exportGate({ dateSet: false, others: ['Incoterm'] }).hint).toMatch(/All dates/)
    expect(exportGate({ dateSet: false, others: [] }).hint).toMatch(/date.*and add one more/)
    expect(exportGate({ dateSet: true, others: ['Product'] }).hint).toBe('')
  })
})
