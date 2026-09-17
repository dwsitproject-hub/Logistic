'use client'

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { isoDateStringToDdMmYyyy, parseDdMmYyyyToIso, isIsoOutsideAllowedRange } from '@/lib/dateFormat'
import { handleFastEntryKeyDown, FAST_ENTRY_FOCUSABLE_ATTR, FAST_ENTRY_GROUP_ATTR } from '@/lib/fastEntryFocus'
import { Calendar } from 'lucide-react'

type Props = {
  valueIso: string | null | undefined
  onChangeIso: (iso: string) => void
  className?: string
  disabled?: boolean
  minIso?: string
  maxIso?: string
  /** Enables Enter/Tab to jump to the next field in this fast-entry group. */
  fastEntryGroup?: string
}

/** Build DD/MM/YYYY display from digit string; optional trailing slash while typing. */
function formatDdMmYyyyDraft(digits: string, trailingSlash = false): string {
  const d = digits.slice(0, 8)
  if (d.length <= 2) {
    return trailingSlash && d.length === 2 ? `${d}/` : d
  }
  if (d.length <= 4) {
    const base = `${d.slice(0, 2)}/${d.slice(2)}`
    return trailingSlash && d.length === 4 ? `${base}/` : base
  }
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

/** Global sanity bounds (N-14): typing an ID into a date field must not reach the API
 *  as year 10610 — callers can narrow further via minIso/maxIso but never widen. */
const DEFAULT_MIN_ISO = '2020-01-01'
const DEFAULT_MAX_ISO = '2035-12-31'
const RANGE_MESSAGE = 'Please enter a valid date (2020–2035)'

/** Text input showing **DD/MM/YYYY**; stores **YYYY-MM-DD** via onChangeIso (same as native date value to API). */
export function DateInputDdMmYyyy({ valueIso, onChangeIso, className, disabled, minIso, maxIso, fastEntryGroup }: Props) {
  const [draft, setDraft] = useState('')
  const [rangeRejected, setRangeRejected] = useState(false)

  const effMinIso = minIso ?? DEFAULT_MIN_ISO
  const effMaxIso = maxIso ?? DEFAULT_MAX_ISO
  /** True when the date parsed but falls outside the allowed window — do not emit it. */
  const rejectOutOfRange = (iso: string): boolean => {
    const rejected = isIsoOutsideAllowedRange(iso, effMinIso, effMaxIso)
    setRangeRejected(rejected)
    return rejected
  }

  const normalizedIso = useMemo(() => {
    const iso = String(valueIso ?? '').trim()
    if (!iso) return ''
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : ''
  }, [valueIso])

  useEffect(() => {
    setDraft(isoDateStringToDdMmYyyy(valueIso))
  }, [valueIso])

  const isOutOfRange =
    rangeRejected ||
    Boolean(normalizedIso && isIsoOutsideAllowedRange(normalizedIso, effMinIso, effMaxIso))

  return (
    <div className="relative">
      <Input
        type="text"
        placeholder="DD/MM/YYYY"
        disabled={disabled}
        title={isOutOfRange ? RANGE_MESSAGE : undefined}
        aria-invalid={isOutOfRange || undefined}
        className={`${className ?? ''} pr-9 ${isOutOfRange ? 'border-red-500' : ''}`}
        value={draft}
        {...(fastEntryGroup
          ? {
              [FAST_ENTRY_FOCUSABLE_ATTR]: 'true',
              [FAST_ENTRY_GROUP_ATTR]: fastEntryGroup,
            }
          : {})}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (fastEntryGroup) handleFastEntryKeyDown(e)
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d/]/g, '')
          const digits = raw.replace(/\D/g, '').slice(0, 8)
          const trailingSlash =
            raw.endsWith('/') && (digits.length === 2 || digits.length === 4)
          const next = formatDdMmYyyyDraft(digits, trailingSlash)
          setDraft(next)
          if (digits.length === 8) {
            const iso = parseDdMmYyyyToIso(next)
            if (iso && !rejectOutOfRange(iso)) onChangeIso(iso)
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (!text) return
          const iso = parseDdMmYyyyToIso(text)
          if (iso) {
            e.preventDefault()
            if (rejectOutOfRange(iso)) return
            onChangeIso(iso)
            setDraft(isoDateStringToDdMmYyyy(iso))
          }
        }}
        onBlur={() => {
          const t = draft.trim()
          if (!t) {
            setRangeRejected(false)
            onChangeIso('')
            return
          }
          const iso = parseDdMmYyyyToIso(t)
          if (iso && !rejectOutOfRange(iso)) {
            onChangeIso(iso)
            setDraft(isoDateStringToDdMmYyyy(iso))
          } else {
            // Unparseable or out of range: restore the last valid value.
            setDraft(isoDateStringToDdMmYyyy(valueIso))
            if (!iso) setRangeRejected(false)
          }
        }}
      />

      {/* Date picker (native) anchored beside the field */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8">
        <Calendar className="h-4 w-4 text-gray-500 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="date"
          disabled={disabled}
          min={effMinIso}
          max={effMaxIso}
          value={normalizedIso}
          tabIndex={-1}
          onChange={(e) => {
            const v = e.target.value
            if (!v) {
              setRangeRejected(false)
              onChangeIso('')
              setDraft('')
              return
            }
            if (rejectOutOfRange(v)) return
            onChangeIso(v)
            setDraft(isoDateStringToDdMmYyyy(v))
          }}
          // Make the actual picker trigger sit exactly on the icon,
          // so the browser anchors the calendar next to this field.
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label="Pick date"
        />
      </div>
    </div>
  )
}
