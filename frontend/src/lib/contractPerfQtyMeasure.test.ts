import { describe, expect, it } from 'vitest'
import {
  contractPerfQtyMeasureIsMixed,
  contractPerfQtyMeasureLabel,
} from '@/lib/contractPerfQtyMeasure'

describe('contractPerfQtyMeasureLabel', () => {
  it('names the single measure when a card is selected', () => {
    expect(contractPerfQtyMeasureLabel('Open')).toBe('Qty = Outstanding Qty (MT)')
    expect(contractPerfQtyMeasureLabel('Close')).toBe('Qty = Contract Qty (MT)')
  })

  it('says both measures when neither card is selected', () => {
    expect(contractPerfQtyMeasureLabel('All')).toBe(
      'Qty = Outstanding Qty (Open) + Contract Qty (Close)',
    )
  })
})

describe('contractPerfQtyMeasureIsMixed', () => {
  it('is mixed only with no card selected', () => {
    expect(contractPerfQtyMeasureIsMixed('All')).toBe(true)
    expect(contractPerfQtyMeasureIsMixed('Open')).toBe(false)
    expect(contractPerfQtyMeasureIsMixed('Close')).toBe(false)
  })
})
