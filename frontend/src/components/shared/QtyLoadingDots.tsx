'use client'

/**
 * Loading placeholder for list-table value cells that are hydrated after first paint
 * (e.g. SAP-derived quantities). Renders a static ellipsis ("...") so users can
 * distinguish "still loading" from a genuinely empty value (which shows "—").
 */
export function QtyLoadingDots({ className = '' }: { className?: string }) {
  return (
    <span
      className={`text-sm text-gray-400 tabular-nums ${className}`.trim()}
      title="Loading…"
      aria-label="Loading"
    >
      ...
    </span>
  )
}
