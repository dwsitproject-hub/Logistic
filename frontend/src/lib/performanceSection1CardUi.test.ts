import { describe, expect, it } from 'vitest'
import {
  PERFORMANCE_SECTION1_CARD_ACCENTS,
  type PerformanceSection1CardVariant,
} from './performanceSection1CardUi'

describe('performanceSection1CardUi', () => {
  it('defines accents for all Section 1 variants', () => {
    const variants: PerformanceSection1CardVariant[] = ['open', 'close', 'ongoing', 'completed']
    for (const variant of variants) {
      const accent = PERFORMANCE_SECTION1_CARD_ACCENTS[variant]
      expect(accent.icon).toBeTruthy()
      expect(accent.surface).toContain('bg-white')
      expect(accent.surface).toContain('border-')
      expect(accent.chip).toMatch(/bg-/)
      expect(accent.selected).toContain('ring-2')
    }
  })

  it('uses blue for open/ongoing and amber for close/completed', () => {
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.open.surface).toContain('blue')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.ongoing.surface).toContain('blue')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.close.surface).toContain('amber')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.completed.surface).toContain('amber')
  })
})
