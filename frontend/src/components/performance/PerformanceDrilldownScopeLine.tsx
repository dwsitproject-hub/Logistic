'use client'

import { Fragment } from 'react'

/**
 * Compact scope line under performance Section 2 titles.
 * Plain gray subtitle (matches multi-select empty placeholders), · separators.
 */
export default function PerformanceDrilldownScopeLine({
  segments,
}: {
  segments: readonly string[]
}) {
  const parts = segments.map((s) => String(s ?? '').trim()).filter(Boolean)
  if (parts.length === 0) return null

  return (
    <div className="text-xs text-gray-500 mt-0.5 leading-snug font-normal">
      {parts.map((part, index) => (
        <Fragment key={`${index}-${part}`}>
          {index > 0 ? (
            <span className="text-gray-400 mx-1" aria-hidden>
              ·
            </span>
          ) : null}
          <span className="text-gray-500">{part}</span>
        </Fragment>
      ))}
    </div>
  )
}
