'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'

interface PlantOption {
  id: string
  plant_code: string
  plant_name: string
  company_name: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Which field to use as the selected value. Defaults to 'plant_name'. */
  valueField?: 'plant_name' | 'company_name'
}

export function PlantSiteCombobox({ value, onChange, placeholder = 'Search plant/site...', className, disabled, valueField = 'plant_name' }: Props) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<PlantOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external value → input text
  useEffect(() => {
    setQuery(value)
  }, [value])

  // Click outside closes dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await api.get('/master-plants', { params: { search: q, limit: 20 } })
        setOptions(res.data?.data?.items || [])
      } catch {
        setOptions([])
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

  const handleSelect = (opt: PlantOption) => {
    const label = opt[valueField] || opt.plant_name
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
              key={opt.id}
              type="button"
              onMouseDown={() => handleSelect(opt)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-0"
            >
              <div className="text-sm font-medium text-gray-800">{opt.plant_name}</div>
              <div className="text-xs text-gray-400">{opt.plant_code} · {opt.company_name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
