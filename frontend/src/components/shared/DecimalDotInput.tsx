'use client'

import * as React from 'react'
import { Input, type InputProps } from '@/components/ui/input'
import {
  blockCommaDecimalKeyDown,
  decimalDraftToValue,
  resolveDecimalDraftDisplay,
  sanitizeDecimalDotInput,
} from '@/lib/decimalDotInput'

type Props = Omit<InputProps, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  /** The number the form holds, in the unit shown (MT, not kg). */
  value: number | null
  onValueChange: (value: number | null) => void
  /** What a cleared field (or a lone ".") is stored as. Default null; the shipment qty cells store 0. */
  emptyAs?: number | null
}

/**
 * Decimal-dot number field for the shipment modals. It keeps the text being typed, so "12." keeps its dot and
 * "1.05" can be typed through "1.0"; the form still holds a plain number. Comma stays blocked (see decimalDotInput).
 * On blur the text snaps back to the number, so what is left on screen is what is stored.
 */
export function DecimalDotInput({ value, onValueChange, emptyAs = null, onKeyDown, onBlur, ...rest }: Props) {
  const [draft, setDraft] = React.useState<string | null>(null)
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={resolveDecimalDraftDisplay(draft, value, emptyAs)}
      onKeyDown={(e) => {
        blockCommaDecimalKeyDown(e)
        onKeyDown?.(e)
      }}
      onChange={(e) => {
        const raw = e.target.value
        if (sanitizeDecimalDotInput(raw) === null) return
        setDraft(raw)
        onValueChange(decimalDraftToValue(raw, emptyAs))
      }}
      onBlur={(e) => {
        setDraft(null)
        onBlur?.(e)
      }}
    />
  )
}
