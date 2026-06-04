'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function BuyerCombobox({ value, onChange, placeholder = 'Search buyer...', className, disabled }: Props) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const mergeWithCurrent = (list: string[]) => {
    const v = value.trim()
    if (!v) return list
    const has = list.some((x) => x.toLowerCase() === v.toLowerCase())
    return has ? list : [v, ...list]
  }

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.get('/contracts/buyers', { params: { search: q, limit: 30 } })
        const raw: string[] = res.data?.data?.items || []
        setOptions(mergeWithCurrent(raw))
      } catch {
        setOptions(mergeWithCurrent([]))
      } finally {
        setLoading(false)
      }
    }, 250)
  }

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

  const handleSelect = (label: string) => {
    setQuery(label)
    onChange(label)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={handleInputChange}
        onFocus={handleFocus}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoComplete="off"
      />
      {open && (options.length > 0 || loading) && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg max-h-60 overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-sm text-gray-400">Loading...</div>
          )}
          {!loading && options.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={() => handleSelect(opt)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-0"
            >
              <div className="text-sm font-medium text-gray-800">{opt}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
