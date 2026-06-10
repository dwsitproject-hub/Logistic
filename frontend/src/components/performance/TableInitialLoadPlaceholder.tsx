'use client'

import { Loader2, Table2, type LucideIcon } from 'lucide-react'

type TableInitialLoadPlaceholderProps = {
  colSpan: number
  icon?: LucideIcon
  message?: string
}

/** First-paint table body placeholder — only when fetching with no cached rows yet. */
export function TableInitialLoadPlaceholder({
  colSpan,
  icon: Icon = Table2,
  message = 'Loading data...',
}: TableInitialLoadPlaceholderProps) {
  return (
    <tr className="bg-white">
      <td colSpan={colSpan} className="px-4">
        <TableInitialLoadPlaceholderContent icon={Icon} message={message} />
      </td>
    </tr>
  )
}

type TableInitialLoadPlaceholderContentProps = {
  icon?: LucideIcon
  message?: string
  className?: string
}

/** Shared centered content for table cell or mobile card container. */
export function TableInitialLoadPlaceholderContent({
  icon: Icon = Table2,
  message = 'Loading data...',
  className = '',
}: TableInitialLoadPlaceholderContentProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-16 gap-3 ${className}`.trim()}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <Icon className="h-16 w-16 text-gray-300" strokeWidth={1.25} aria-hidden />
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />
        <span>{message}</span>
      </div>
    </div>
  )
}
