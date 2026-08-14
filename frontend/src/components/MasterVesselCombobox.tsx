'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'
import { formatVesselCodeDisplay } from '@/lib/formatVesselCodeDisplay'
import { formatNumber } from '@/lib/utils'

export interface MasterVesselOption {
  id: string
  vessel_code: string | null
  vessel_name: string
  vessel_capacity_mt: number | null
  vessel_owner: string | null
  vessel_type?: string | null
  hull_type?: string | null
  terms?: string | null
}

interface Props {
  value: string
  onSelect: (vessel: MasterVesselOption) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function MasterVesselCombobox({
  value,
  onSelect,
  placeholder = 'Search Master Vessel…',
  className,
  disabled,
}: Props) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<MasterVesselOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

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
  }, [open, options.length, loading, searched, updateDropdownPosition])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
      setQuery(value)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [value])

  const fetchOptions = useCallback(async (q: string) => {
    const search = q.trim()
    if (search.length < 2) {
      setOptions([])
      setSearched(true)
      setLoading(false)
      return
    }
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const res = await api.get('/master-vessels', { params: { search, limit: 20 } })
      if (requestId !== requestIdRef.current) return
      setOptions((res.data?.data?.items ?? []) as MasterVesselOption[])
    } catch {
      if (requestId !== requestIdRef.current) return
      setOptions([])
    } finally {
      if (requestId !== requestIdRef.current) return
      setLoading(false)
      setSearched(true)
    }
  }, [])

  const search = useCallback(
    (q: string, immediate = false) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (immediate) {
        void fetchOptions(q)
        return
      }
      debounceRef.current = setTimeout(() => {
        void fetchOptions(q)
      }, 250)
    },
    [fetchOptions],
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setQuery(q)
    setOpen(true)
    setSearched(false)
    search(q)
  }

  const handleFocus = () => {
    setOpen(true)
    setSearched(false)
    search(query, true)
  }

  const handleBlur = () => {
    setTimeout(() => {
      setOpen(false)
      setQuery(value)
    }, 180)
  }

  const handleSelect = (opt: MasterVesselOption) => {
    const label = String(opt.vessel_name ?? '').trim()
    setQuery(label)
    onSelect(opt)
    setOpen(false)
    setSearched(false)
  }

  const showDropdown = open && (loading || searched)
  const dropdown =
    showDropdown && dropdownRect && mounted ? (
      <div
        ref={dropdownRef}
        role="listbox"
        className="max-h-60 overflow-y-auto rounded-md border bg-white shadow-lg"
        style={{
          position: 'fixed',
          top: dropdownRect.top,
          left: dropdownRect.left,
          width: dropdownRect.width,
          zIndex: 99999,
        }}
      >
        {loading && <div className="px-3 py-2 text-sm text-gray-400">Loading...</div>}
        {!loading && query.trim().length < 2 && (
          <div className="px-3 py-2 text-sm text-gray-500">Type at least 2 characters</div>
        )}
        {!loading && query.trim().length >= 2 && options.length === 0 && (
          <div className="px-3 py-2 text-sm text-gray-500">No vessels in Master Vessel</div>
        )}
        {!loading &&
          options.map((opt) => (
            <button
              key={`${opt.id}-${opt.vessel_code ?? 'pending'}`}
              type="button"
              onMouseDown={() => handleSelect(opt)}
              className="w-full border-b px-3 py-2 text-left last:border-0 hover:bg-blue-50"
            >
              <div className="text-sm font-semibold text-gray-900">{opt.vessel_name}</div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                <span className="font-mono">{formatVesselCodeDisplay(opt.vessel_code)}</span>
                {opt.vessel_owner ? (
                  <>
                    <span className="text-gray-300">•</span>
                    <span>{opt.vessel_owner}</span>
                  </>
                ) : null}
                {opt.vessel_capacity_mt != null ? (
                  <>
                    <span className="text-gray-300">•</span>
                    <span className="font-medium text-cyan-600">
                      {formatNumber(opt.vessel_capacity_mt)} MT
                    </span>
                  </>
                ) : null}
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
        onBlur={handleBlur}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoComplete="off"
      />
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
