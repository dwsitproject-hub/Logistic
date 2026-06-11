'use client'

import { Table2, type LucideIcon } from 'lucide-react'

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
      className={`flex flex-col items-center justify-center py-12 gap-2 ${className}`.trim()}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <Icon className="h-10 w-10 text-gray-300" strokeWidth={1.25} aria-hidden />
      <span className="text-xs text-gray-400">{message}</span>
    </div>
  )
}
