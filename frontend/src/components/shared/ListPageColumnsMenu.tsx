'use client'

import { useState } from 'react'
import { GripVertical, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { ListColumnDef } from '@/lib/listColumnLayout'

type ListPageColumnsMenuProps = {
  columns: readonly ListColumnDef[]
  visibleIds: readonly string[]
  disabled?: boolean
  onToggle: (id: string) => void
  onSelectAll: () => void
  onUnselectAll: () => void
  onReset: () => void
  onReorder: (dragId: string, dropId: string) => void
}

/** Columns menu copied from the Contracts view table: select, reset, and drag order. */
export function ListPageColumnsMenu({
  columns,
  visibleIds,
  disabled,
  onToggle,
  onSelectAll,
  onUnselectAll,
  onReset,
  onReorder,
}: ListPageColumnsMenuProps) {
  const [open, setOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const visible = new Set(visibleIds)

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)} disabled={disabled}>
        <SlidersHorizontal className="h-4 w-4 mr-2" />
        Columns
      </Button>
      {open ? (
        <div className="absolute right-0 mt-2 w-64 rounded-md border bg-white shadow-md z-50 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs font-semibold text-gray-600">Visible columns</div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-1 mb-2">
            <Button variant="ghost" size="sm" className="flex-1 text-xs h-7" onClick={onSelectAll}>
              Select All
            </Button>
            <Button variant="ghost" size="sm" className="flex-1 text-xs h-7" onClick={onUnselectAll}>
              Unselect All
            </Button>
            <Button variant="ghost" size="sm" className="flex-1 text-xs h-7" onClick={onReset}>
              Reset
            </Button>
          </div>
          <div className="border-t pt-2 space-y-2 max-h-72 overflow-auto pr-1">
            {columns.map((col) => (
              <div
                key={col.id}
                draggable
                onDragStart={() => setDragId(col.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragId && dragId !== col.id) onReorder(dragId, col.id)
                }}
                className={`flex items-center gap-2 text-sm cursor-grab select-none rounded px-1 py-0.5 ${
                  dragId === col.id ? 'opacity-40' : 'hover:bg-gray-50'
                }`}
              >
                <GripVertical className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                  <Checkbox checked={visible.has(col.id)} onCheckedChange={() => onToggle(col.id)} />
                  <span className="truncate">{col.label}</span>
                </label>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
