'use client'

import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from '@/lib/documentTypes'
import { pct } from '@/lib/format'

export type CompletenessRow = {
  key: string
  name: string
  /** Shown small after the name (e.g. the SAP number beside a person's name). */
  sub?: string | null
  contractCount: number
  completeCount: number
  emptyCount: number
  completenessPct: number
  uploadedSlots: number
  totalSlots: number
  /** POs with each document type uploaded: the detail of the row. Without it the row does not open. */
  byType?: Record<string, number>
}

/**
 * The rows of Dashboard > Completeness (By plant and By user): the name, a bar of the POs by how many documents they have, the completeness %, the
 * number of POs, and how many have all 11 or nothing yet. A row opens (click or Enter) to show, for that plant or person, how many POs have each
 * of the 11 document types. One row is open at a time.
 */
export function CompletenessRows({ firstLabel, rows }: { firstLabel: string; rows: CompletenessRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="cr" role="table" aria-label={`Completeness by ${firstLabel.toLowerCase()}`}>
      <div className="cr-row cr-head" role="row">
        <span />
        <span role="columnheader">{firstLabel}</span>
        <span role="columnheader">Documents uploaded</span>
        <span className="r" role="columnheader">
          %
        </span>
        <span className="r" role="columnheader">
          POs
        </span>
        <span className="r cr-hide" role="columnheader">
          All 11
        </span>
        <span className="r cr-hide" role="columnheader">
          Nothing yet
        </span>
      </div>
      {rows.map((r) => {
        const some = Math.max(0, r.contractCount - r.completeCount - r.emptyCount)
        const w = (n: number) => (r.contractCount ? `${(n / r.contractCount) * 100}%` : '0%')
        const canOpen = Boolean(r.byType)
        const isOpen = open === r.key
        return (
          <div key={r.key} className={isOpen ? 'cr-item cr-open' : 'cr-item'} role="rowgroup">
            <button
              type="button"
              className="cr-row"
              role="row"
              aria-expanded={canOpen ? isOpen : undefined}
              onClick={() => canOpen && setOpen(isOpen ? null : r.key)}
              style={canOpen ? undefined : { cursor: 'default' }}
            >
              <span className="cr-chev" aria-hidden>
                {canOpen ? <ChevronRight /> : null}
              </span>
              <span className="cr-name" role="cell" title={r.sub ? `${r.name} · ${r.sub}` : r.name}>
                <b>{r.name}</b>
                {r.sub ? <span className="hint"> · {r.sub}</span> : null}
              </span>
              <span role="cell">
                <span className="track" title={`${r.name}: ${r.completeCount} with all 11, ${some} with some, ${r.emptyCount} with none`}>
                  <i className="a" style={{ width: w(r.completeCount) }} />
                  <i className="b" style={{ width: w(some) }} />
                </span>
              </span>
              <span className="r" role="cell">
                <b>{r.completenessPct.toFixed(1)}%</b>
              </span>
              <span className="r" role="cell">
                {r.contractCount.toLocaleString('en-US')}
              </span>
              <span className="r cr-hide" role="cell">
                {r.completeCount.toLocaleString('en-US')}
              </span>
              <span className="r cr-hide" role="cell" style={{ color: r.emptyCount ? 'var(--bad)' : undefined }}>
                {r.emptyCount.toLocaleString('en-US')}
              </span>
            </button>
            {isOpen && r.byType ? (
              <div className="cr-detail">
                <p className="hint" style={{ margin: '0 0 8px' }}>
                  POs of <b>{r.name}</b> that have each document ({r.contractCount.toLocaleString('en-US')} POs, {r.uploadedSlots.toLocaleString('en-US')} of {r.totalSlots.toLocaleString('en-US')} documents)
                </p>
                <div className="cr-doc-grid">
                  {DOCUMENT_TYPES.map((t) => {
                    const n = r.byType?.[t] || 0
                    const p = pct(n, r.contractCount)
                    return (
                      <div className="cr-doc" key={t} title={`${DOCUMENT_LABELS[t]}: ${n.toLocaleString('en-US')} of ${r.contractCount.toLocaleString('en-US')} POs`}>
                        <span className="cr-doc-name">{DOCUMENT_LABELS[t]}</span>
                        <span className="track">
                          <i className="a" style={{ width: `${p}%` }} />
                        </span>
                        <span className="r">
                          <b>{p.toFixed(1)}%</b> <span className="hint">{n.toLocaleString('en-US')}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
