'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  fetchShipmentAvailablePurchaseOrders,
  type ShipmentPoOption,
} from '@/components/shared/addNewShipmentTypes'

function formatMt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

interface Props {
  shipmentId: string
  selected: ShipmentPoOption | null
  onSelect: (option: ShipmentPoOption | null) => void
  disabled?: boolean
  className?: string
}

export function ShipmentPoSearchCombobox({
  shipmentId,
  selected,
  onSelect,
  disabled,
  className,
}: Props) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ShipmentPoOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (selected) {
      setQuery(selected.label)
    } else {
      setQuery('')
    }
  }, [selected])

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
        const trimmed = q.trim()
        if (trimmed.length < 2) {
          setOptions([])
          setLoading(false)
          return
        }
        setLoading(true)
        try {
          const rows = await fetchShipmentAvailablePurchaseOrders(shipmentId, { search: trimmed, limit: 50 })
          setOptions(rows)
        } catch {
          setOptions([])
        } finally {
          setLoading(false)
        }
      }, 300)
    },
    [shipmentId],
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setQuery(q)
    if (selected && q !== selected.label) {
      onSelect(null)
    }
    setOpen(true)
    setLoading(q.trim().length >= 2)
    search(q)
  }

  const handleFocus = () => {
    setOpen(true)
    if (query.trim().length >= 2) search(query)
  }

  const handleSelect = (opt: ShipmentPoOption) => {
    setQuery(opt.label)
    onSelect(opt)
    setOpen(false)
  }

  const showDropdown = open && (loading || options.length > 0 || query.trim().length >= 2)

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
          zIndex: 10000,
        }}
      >
        {loading && (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Searching…
          </div>
        )}
        {!loading && query.trim().length < 2 && (
          <div className="px-3 py-2 text-sm text-gray-400">Type at least 2 characters to search PO</div>
        )}
        {!loading && query.trim().length >= 2 && options.length === 0 && (
          <div className="px-3 py-2 text-sm text-gray-400">No eligible PO found</div>
        )}
        {!loading &&
          options.map((opt) => {
            const outstandingKg = Number(opt.contractData?.outstanding_quantity ?? 0)
            const outstandingMt = Number.isFinite(outstandingKg) ? outstandingKg / 1000 : 0
            const supplier = String(opt.contractData?.supplier ?? '').trim()
            return (
              <button
                key={opt.key}
                type="button"
                onMouseDown={() => handleSelect(opt)}
                className="w-full border-b px-3 py-2 text-left last:border-0 hover:bg-gray-50"
              >
                <div className="text-sm font-medium text-gray-800">{opt.label}</div>
                <div className="text-xs text-gray-500">
                  {opt.contractId}
                  {supplier ? ` · ${supplier}` : ''}
                  {outstandingMt > 0 ? ` · ${formatMt(outstandingMt)} MT outstanding` : ''}
                </div>
              </button>
            )
          })}
      </div>
    ) : null

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={handleInputChange}
        onFocus={handleFocus}
        placeholder="Search PO, contract, supplier…"
        className={className}
        disabled={disabled}
        autoComplete="off"
      />
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  )
}
