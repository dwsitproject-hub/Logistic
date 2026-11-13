import { describe, expect, it } from 'vitest'
import {
  PERFORMANCE_SECTION1_CARD_ACCENTS,
  type PerformanceSection1CardVariant,
} from './performanceSection1CardUi'

describe('performanceSection1CardUi', () => {
  const variants: PerformanceSection1CardVariant[] = ['open', 'close', 'ongoing', 'completed']

  it('defines accents for all Section 1 variants', () => {
    for (const variant of variants) {
      const accent = PERFORMANCE_SECTION1_CARD_ACCENTS[variant]
      expect(accent.icon).toBeTruthy()
      expect(accent.chip).toMatch(/bg-/)
      expect(accent.focus).toMatch(/focus-visible:ring-/)
    }
  })

  it('is the quiet card of the Contracts and master pages: white, a grey outline, no gradient', () => {
    for (const variant of variants) {
      const accent = PERFORMANCE_SECTION1_CARD_ACCENTS[variant]
      expect(accent.surface).toContain('bg-white')
      expect(accent.surface).toContain('border-gray-200')
      expect(accent.selected).not.toContain('gradient')
      expect(accent.selected).not.toContain('border-2')
      expect(accent.selected).toContain('ring-1')
      expect(accent.selected).toContain('bg-white')
    }
  })

  it('follows the Open and Close cards of Contracts: amber for open and on going, green for close and completed', () => {
    for (const variant of ['open', 'ongoing'] as const) {
      const accent = PERFORMANCE_SECTION1_CARD_ACCENTS[variant]
      expect(accent.chip).toContain('amber')
      expect(accent.selected).toContain('border-amber-400')
      expect(accent.focus).toContain('amber')
    }
    for (const variant of ['close', 'completed'] as const) {
      const accent = PERFORMANCE_SECTION1_CARD_ACCENTS[variant]
      expect(accent.chip).toContain('emerald')
      expect(accent.selected).toContain('border-emerald-400')
      expect(accent.focus).toContain('emerald')
    }
  })
})
