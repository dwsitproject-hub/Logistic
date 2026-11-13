import { describe, expect, it } from 'vitest'
import { ICON_BUTTON_TONE_CLASS, iconButtonClass, type IconButtonTone } from './iconButton'

const TONES = Object.keys(ICON_BUTTON_TONE_CLASS) as IconButtonTone[]

describe('iconButtonClass', () => {
  it('draws no outline and washes the background of its own colour on hover', () => {
    for (const tone of TONES) {
      const cls = iconButtonClass(tone)
      expect(cls).not.toMatch(/\bborder\b|border-/)
      expect(cls).toMatch(/hover:bg-/)
      expect(cls).toContain('h-9 w-9')
    }
  })

  it('gives every action kind its own colour, so Sync and Add never look alike', () => {
    const colours = TONES.map((tone) => /text-([a-z]+)-\d+/.exec(ICON_BUTTON_TONE_CLASS[tone])?.[1])
    expect(new Set(colours).size).toBe(TONES.length)
    expect(ICON_BUTTON_TONE_CLASS.sync).not.toBe(ICON_BUTTON_TONE_CLASS.add)
  })
})
