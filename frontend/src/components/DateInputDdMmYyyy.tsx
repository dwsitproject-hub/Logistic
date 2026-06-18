'use client'

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { isoDateStringToDdMmYyyy, parseDdMmYyyyToIso } from '@/lib/dateFormat'
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

/** Text input showing **DD/MM/YYYY**; stores **YYYY-MM-DD** via onChangeIso (same as native date value to API). */
export function DateInputDdMmYyyy({ valueIso, onChangeIso, className, disabled, minIso, maxIso, fastEntryGroup }: Props) {
  const [draft, setDraft] = useState('')

  const normalizedIso = useMemo(() => {
    const iso = String(valueIso ?? '').trim()
    if (!iso) return ''
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
    return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : ''
  }, [valueIso])

  useEffect(() => {
    setDraft(isoDateStringToDdMmYyyy(valueIso))
  }, [valueIso])

  return (
    <div className="relative">
      <Input
        type="text"
        placeholder="DD/MM/YYYY"
        disabled={disabled}
        className={`${className ?? ''} pr-9`}
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
            if (iso && !(minIso && iso < minIso) && !(maxIso && iso > maxIso)) {
              onChangeIso(iso)
            }
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (!text) return
          const iso = parseDdMmYyyyToIso(text)
          if (iso) {
            e.preventDefault()
            if ((minIso && iso < minIso) || (maxIso && iso > maxIso)) return
            onChangeIso(iso)
            setDraft(isoDateStringToDdMmYyyy(iso))
          }
        }}
        onBlur={() => {
          const t = draft.trim()
          if (!t) {
            onChangeIso('')
            return
          }
          const iso = parseDdMmYyyyToIso(t)
          if (iso) {
            if ((minIso && iso < minIso) || (maxIso && iso > maxIso)) {
              // Out of range — revert to previous value
              setDraft(isoDateStringToDdMmYyyy(valueIso))
              return
            }
            onChangeIso(iso)
            setDraft(isoDateStringToDdMmYyyy(iso))
          } else {
            setDraft(isoDateStringToDdMmYyyy(valueIso))
          }
        }}
      />

      {/* Date picker (native) anchored beside the field */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8">
        <Calendar className="h-4 w-4 text-gray-500 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="date"
          disabled={disabled}
          min={minIso}
          max={maxIso}
          value={normalizedIso}
          tabIndex={-1}
          onChange={(e) => {
            const v = e.target.value
            if (!v) {
              onChangeIso('')
              setDraft('')
              return
            }
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
