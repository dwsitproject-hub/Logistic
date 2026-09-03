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
      expect(accent.selected).toContain('border-2')
      expect(accent.selected).toContain('ring-2')
      expect(accent.selected).toContain('bg-gradient-to-r')
      expect(accent.focus).toMatch(/focus-visible:ring-/)
    }
  })

  it('uses blue for open/ongoing and amber for close/completed', () => {
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.open.surface).toContain('blue')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.ongoing.surface).toContain('blue')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.open.focus).toContain('blue')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.ongoing.focus).toContain('blue')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.close.surface).toContain('amber')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.completed.surface).toContain('amber')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.close.focus).toContain('amber')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.completed.focus).toContain('amber')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.close.selected).toContain('amber')
    expect(PERFORMANCE_SECTION1_CARD_ACCENTS.completed.selected).toContain('amber')
  })

  it('selected open/ongoing follows App Tour blue gradient', () => {
    for (const variant of ['open', 'ongoing'] as const) {
      const selected = PERFORMANCE_SECTION1_CARD_ACCENTS[variant].selected
      expect(selected).toContain('from-blue-50')
      expect(selected).toContain('to-indigo-50')
      expect(selected).toContain('border-2')
      expect(selected).toContain('border-blue-400')
    }
  })

  it('selected close/completed follows Logout amber gradient', () => {
    for (const variant of ['close', 'completed'] as const) {
      const selected = PERFORMANCE_SECTION1_CARD_ACCENTS[variant].selected
      expect(selected).toContain('from-amber-50')
      expect(selected).toContain('to-orange-50')
      expect(selected).toContain('border-2')
      expect(selected).toContain('border-amber-400')
    }
  })
})
