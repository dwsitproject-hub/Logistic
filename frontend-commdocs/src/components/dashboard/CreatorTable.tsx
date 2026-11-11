'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CompletenessRows } from '@/components/dashboard/CompletenessRows'
import { ErrorNote, Spinner } from '@/components/ui'
import { longDate, plural } from '@/lib/format'
import type { CreatorCompleteness } from '@/lib/types'

type Order = 'complete' | 'gaps'
type Run = { outcome: string; trigger: string; at: string; fileName: string | null; detail: string | null }
export type CreatorPayload = {
  creators: CreatorCompleteness[]
  loaded: { pos: number; creators: number; loadedAt: string | null }
  /** The scheduled load from the SAP share: whether it is on, the last run that loaded a file, and the last run of any kind. */
  auto?: { enabled: boolean; lastLoaded: Run | null; lastRun: Run | null }
}

/**
 * The "By user" view of the Dashboard's Completeness: the same bars as By plant, one per person, with the number of POs that person created in SAP
 * (GET /api/commercial-documents/completeness-by-creator). The creator is the "Created by" of the SAP ME2N report, loaded every morning from the SAP
 * share by the schedule; the ME2N Report menu (administrators) is the backup, so this view has no buttons.
 * SAP gives an employee number (NIK). A name for it will come from the PRC application, so for now the number is what shows: `displayName` and the
 * commercial_creator_names table are the place for that sync, and nothing here edits them. POs the report does not know have no creator, so they are
 * not listed (the API still returns them as an empty createdBy, so the totals there add up).
 */
export function CreatorTable({
  payload,
  loading,
  error,
  isAdmin,
}: {
  /** Loaded by the Dashboard in the background as soon as the plants are in, so opening this view shows it at once. */
  payload: CreatorPayload | null
  loading: boolean
  error: string
  isAdmin: boolean
}) {
  // Only users the report names: the row of POs without a creator is left out.
  const data = useMemo(() => (payload ? { ...payload, creators: (payload.creators || []).filter((c) => c.createdBy) } : null), [payload])
  const [order, setOrder] = useState<Order>('complete')
  const [showAll, setShowAll] = useState(false)

  const rows = useMemo(() => {
    const list = data?.creators || []
    const ratio = (c: CreatorCompleteness) => (c.totalSlots ? c.uploadedSlots / c.totalSlots : 0)
    const sorted = [...list].sort((a, b) => {
      if (order === 'gaps') return ratio(a) - ratio(b) || b.missingSlots - a.missingSlots
      return ratio(b) - ratio(a) || b.contractCount - a.contractCount
    })
    return showAll ? sorted : sorted.slice(0, 10)
  }, [data, order, showAll])

  // The NIK is the SAP number; a name (from the PRC sync, when it exists) goes first and the number stays beside it.
  const label = (c: CreatorCompleteness) => c.displayName || c.createdBy
  const known = data?.loaded.pos || 0
  const total = data?.creators.length || 0
  // A problem shows while the last check is newer than the last successful load: quiet "unchanged" runs do not hide it.
  const lastRun = data?.auto?.lastRun
  const problem =
    lastRun && ['failed', 'source_missing', 'no_file'].includes(lastRun.outcome) && (!data?.auto?.lastLoaded || lastRun.at > data.auto.lastLoaded.at) ? lastRun : null

  return (
    <>
      <div style={{ padding: '10px 16px 0' }} className="chips">
        <button className="chip" type="button" aria-pressed={order === 'complete'} onClick={() => setOrder('complete')}>
          Most complete
        </button>
        <button className="chip" type="button" aria-pressed={order === 'gaps'} onClick={() => setOrder('gaps')}>
          Biggest gaps
        </button>
      </div>
      <div style={{ padding: '8px 16px 0' }}>
        <ErrorNote>{error}</ErrorNote>
      </div>
      {loading ? (
        <div style={{ padding: 16 }}>
          <Spinner />
        </div>
      ) : !known ? (
        <p className="hint" style={{ padding: 16, margin: 0 }}>
          No user data yet.{' '}
          {isAdmin ? (
            <>
              The SAP ME2N report has the &quot;Created by&quot; of every PO: it is loaded every morning, or open{' '}
              <Link className="link" href="/me2n-report">
                ME2N Report
              </Link>{' '}
              to load it now.
            </>
          ) : (
            'The SAP ME2N report has not been loaded yet.'
          )}
        </p>
      ) : (
        <>
          <CompletenessRows
            firstLabel="User (SAP NIK)"
            rows={rows.map((c) => ({
              key: c.createdBy,
              name: label(c),
              sub: c.displayName ? c.createdBy : null,
              contractCount: c.contractCount,
              completeCount: c.completeCount,
              emptyCount: c.emptyCount,
              completenessPct: c.completenessPct,
              uploadedSlots: c.uploadedSlots,
              totalSlots: c.totalSlots,
              byType: c.byType,
            }))}
          />
          {!total ? <p className="hint" style={{ padding: '0 16px' }}>No POs in this period.</p> : null}
        </>
      )}
      {known ? (
        <div className="legend">
          <span>
            <i style={{ background: 'var(--accent)' }} />
            All 11 documents
          </span>
          <span>
            <i style={{ background: '#8FC1C6' }} />
            Some documents
          </span>
          <span>
            <i style={{ background: 'var(--muted-bg)', border: '1px solid var(--line)' }} />
            Nothing yet
          </span>
          {total > 10 ? (
            <button className="link" type="button" onClick={() => setShowAll((v) => !v)} style={{ marginLeft: 'auto' }}>
              {showAll ? 'Show top 10' : `Show all ${total} users`}
            </button>
          ) : null}
        </div>
      ) : null}
      {known ? (
        <p className="hint" style={{ padding: '0 16px 14px', margin: 0 }}>
          POs are counted by the SAP user who created them (NIK), from the SAP ME2N report loaded
          {data?.loaded.loadedAt ? ` on ${longDate(data.loaded.loadedAt)}` : ''} ({plural(known, 'PO')}, {plural(data?.loaded.creators || 0, 'user')}). A PO created after that is not
          listed until the report is loaded again.{' '}
          {data?.auto?.enabled ? 'The SAP share is checked for a new report every morning.' : 'Automatic loading is off on this server.'} Names will come from the PRC application.
        </p>
      ) : null}
      {problem ? (
        <div style={{ padding: '0 16px 14px' }}>
          <div className="alert bad" role="alert">
            <span>
              The last check of the SAP share ({longDate(problem.at)}) found a problem: {problem.detail || problem.outcome}
              {isAdmin ? (
                <>
                  {' '}
                  <Link className="link" href="/me2n-report">
                    Open ME2N Report
                  </Link>
                </>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
    </>
  )
}
