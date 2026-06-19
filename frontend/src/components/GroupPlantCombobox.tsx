'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'

export type GroupPlantOption = {
  id: string
  group_plant: string | null
  plant_name: string
  plant_code: string
  company_name: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** Contract buyer or plant code — default search on focus. */
  hint?: string | null
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function GroupPlantCombobox({
  value,
  onChange,
  hint,
  placeholder = 'Search group plant...',
  className,
  disabled,
}: Props) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<GroupPlantOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setQuery(value)
  }, [value])

  const updateDropdownPosition = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setDropdownRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updateDropdownPosition()
    const onReposition = () => updateDropdownPosition()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, options.length, loading, updateDropdownPosition])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        const term = q.trim() || String(hint ?? '').trim()
        if (!term) {
          setOptions([])
          setLoading(false)
          return
        }
        setLoading(true)
        try {
          const res = await api.get('/master-plants', { params: { search: term, limit: 20 } })
          const items: GroupPlantOption[] = (res.data?.data?.items || []).filter(
            (row: GroupPlantOption) => String(row.group_plant ?? '').trim(),
          )
          setOptions(items)
        } catch {
          setOptions([])
        } finally {
          setLoading(false)
        }
      }, 250)
    },
    [hint],
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setQuery(q)
    onChange(q)
    setOpen(true)
    search(q)
  }

  const handleFocus = () => {
    setOpen(true)
    search(query)
  }

  const handleSelect = (opt: GroupPlantOption) => {
    const label = String(opt.group_plant ?? '').trim()
    setQuery(label)
    onChange(label)
    setOpen(false)
  }

  const showDropdown = open && (options.length > 0 || loading)

  const dropdown =
    showDropdown && dropdownRect && mounted ? (
      <div
        ref={dropdownRef}
        role="listbox"
        className="rounded-md border bg-white shadow-lg max-h-60 overflow-y-auto"
        style={{
          position: 'fixed',
          top: dropdownRect.top,
          left: dropdownRect.left,
          width: dropdownRect.width,
          zIndex: 10000,
        }}
      >
        {loading && <div className="px-3 py-2 text-sm text-gray-400">Loading...</div>}
        {!loading &&
          options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onMouseDown={() => handleSelect(opt)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-0"
            >
              <div className="text-sm font-medium text-gray-800">{opt.group_plant}</div>
              <div className="text-xs text-gray-400">
                {opt.plant_name} · {opt.plant_code}
              </div>
            </button>
          ))}
      </div>
    ) : null

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={handleInputChange}
        onFocus={handleFocus}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoComplete="off"
      />
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
