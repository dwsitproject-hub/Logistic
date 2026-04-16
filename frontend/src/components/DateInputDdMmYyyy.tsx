'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { isoDateStringToDdMmYyyy, parseDdMmYyyyToIso } from '@/lib/dateFormat'

type Props = {
  valueIso: string | null | undefined
  onChangeIso: (iso: string) => void
  className?: string
  disabled?: boolean
}

/** Text input showing **DD/MM/YYYY**; stores **YYYY-MM-DD** via onChangeIso (same as native date value to API). */
export function DateInputDdMmYyyy({ valueIso, onChangeIso, className, disabled }: Props) {
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setDraft(isoDateStringToDdMmYyyy(valueIso))
  }, [valueIso])

  return (
    <Input
      type="text"
      inputMode="numeric"
      placeholder="DD/MM/YYYY"
      disabled={disabled}
      className={className}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = draft.trim()
        if (!t) {
          onChangeIso('')
          return
        }
        const iso = parseDdMmYyyyToIso(t)
        if (iso) {
          onChangeIso(iso)
          setDraft(isoDateStringToDdMmYyyy(iso))
        } else {
          setDraft(isoDateStringToDdMmYyyy(valueIso))
        }
      }}
    />
  )
}
