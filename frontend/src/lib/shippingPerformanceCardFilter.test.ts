import { describe, expect, it } from 'vitest'
import { perfDataModeFromCard } from './shippingPerformanceLabels'

describe('perfDataModeFromCard', () => {
  it('maps ongoing cards to ETA data keys and Close to ATA', () => {
    expect(perfDataModeFromCard('all')).toBe('eta')
    expect(perfDataModeFromCard('ongoingWithEta')).toBe('eta')
    expect(perfDataModeFromCard('ongoingNoEta')).toBe('eta')
    expect(perfDataModeFromCard('close')).toBe('ata')
  })
})
