'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'

interface LoadingPortOption {
  id: string
  port: string
  region: string | null
}

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function MasterLoadingPortCombobox({
  value,
  onChange,
  placeholder = 'Search Master Port...',
  className,
  disabled,
}: Props) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<LoadingPortOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null)
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
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fetchOptions = useCallback(async (q: string) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const res = await api.get('/master-loading-ports', { params: { search: q, limit: 20 } })
      if (requestId !== requestIdRef.current) return
      setOptions(res.data?.data?.items || [])
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
    onChange(q)
    setOpen(true)
    setSearched(false)
    search(q)
  }

  const handleFocus = () => {
    setOpen(true)
    setSearched(false)
    search(query, true)
  }

  const handleSelect = (opt: LoadingPortOption) => {
    const label = opt.port
    setQuery(label)
    onChange(label)
    setOpen(false)
    setSearched(false)
  }

  const showDropdown = open && (loading || searched)

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
          zIndex: 99999,
        }}
      >
        {loading && <div className="px-3 py-2 text-sm text-gray-400">Loading...</div>}
        {!loading && options.length === 0 && (
          <div className="px-3 py-2 text-sm text-gray-500">No ports found</div>
        )}
        {!loading &&
          options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onMouseDown={() => handleSelect(opt)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-0"
            >
              <div className="text-sm font-medium text-gray-800">{opt.port}</div>
              {opt.region && <div className="text-xs text-gray-400">{opt.region}</div>}
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
