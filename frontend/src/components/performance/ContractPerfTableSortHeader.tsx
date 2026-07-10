'use client'

import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { FieldHelp } from '@/components/FieldHelp'
import { COMPACT_TABLE_HEADER_LABEL_CLASS } from '@/lib/compactTableUi'

type ContractPerfTableSortHeaderProps = {
  label: ReactNode
  formulaHelp?: string
  sortable?: boolean
  activeSort: boolean
  sortDir: 'asc' | 'desc'
  onSortClick: () => void
}

/** Matches Contract Performance Section 3 table header: label + optional help + sort icon only. */
export function ContractPerfTableSortHeader({
  label,
  formulaHelp,
  sortable = true,
  activeSort,
  sortDir,
  onSortClick,
}: ContractPerfTableSortHeaderProps) {
  return (
    <div className="flex min-w-0 items-start gap-1">
      <span className={COMPACT_TABLE_HEADER_LABEL_CLASS}>{label}</span>
      {formulaHelp ? (
        <span className="shrink-0 inline-flex items-center">
          <FieldHelp text={formulaHelp} />
        </span>
      ) : null}
      {sortable && (
        <button
          type="button"
          className={`shrink-0 p-0.5 rounded hover:bg-gray-200 ${activeSort ? 'text-blue-600' : 'text-gray-400'}`}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onSortClick()
          }}
          title="Sort"
        >
          {activeSort ? (
            sortDir === 'asc' ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  )
}
