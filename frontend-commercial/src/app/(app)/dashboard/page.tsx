'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ErrorNote, Spinner } from '@/components/ui'
import { apiData, errorMessage, isAbort, toQuery } from '@/lib/api'
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from '@/lib/documentTypes'
import { pct, plural, presetRange, type DatePreset } from '@/lib/format'
import { useSession } from '@/lib/session'
import type { PlantCompleteness, SummaryCard } from '@/lib/types'

type Totals = Omit<PlantCompleteness, 'plant'>

const PERIODS: Array<[DatePreset, string]> = [
  ['ytd', 'This year'],
  ['last30', 'Last 30 days'],
  ['last90', 'Last 90 days'],
  ['lastYear', 'Last year'],
  ['all', 'All dates'],
]

/**
 * Completeness by plant (GET /api/commercial-documents/completeness-by-plant). "Completeness" is KLIP's measure: uploaded
 * checklist slots out of POs x 9. The bars split each plant's POs into all nine / some / none.
 */
export default function DashboardPage() {
  const { access } = useSession()
  const [period, setPeriod] = useState<DatePreset>('ytd')
  const [order, setOrder] = useState<'complete' | 'gaps'>('complete')
  const [showAll, setShowAll] = useState(false)
  const [plants, setPlants] = useState<PlantCompleteness[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [missing, setMissing] = useState<Array<{ label: string; count: number }> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const range = useMemo(() => presetRange(period)!, [period])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError('')
    apiData<{ plants: PlantCompleteness[]; totals: Totals }>(
      `/commercial-documents/completeness-by-plant${toQuery(range)}`,
      { signal: ctrl.signal },
    )
      .then((d) => {
        setPlants(d.plants || [])
        setTotals(d.totals || null)
        setLoading(false)
      })
      .catch((err) => {
        if (isAbort(err)) return
        setError(errorMessage(err, 'Could not load the dashboard. Please try again.'))
        setLoading(false)
      })
    // "Most often missing" comes from the Documents summary, which needs the Documents permission.
    if (access.documents) {
      apiData<{ summary: Record<string, SummaryCard> }>(`/commercial-documents/summary${toQuery(range)}`, { signal: ctrl.signal })
        .then((d) =>
          setMissing(
            DOCUMENT_TYPES.map((t) => ({
              label: DOCUMENT_LABELS[t],
              count: (d.summary?.[t]?.totalCount ?? 0) - (d.summary?.[t]?.uploadedCount ?? 0),
            }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 5),
          ),
        )
        .catch(() => setMissing(null))
    }
    return () => ctrl.abort()
  }, [range, access.documents])

  const sorted = useMemo(() => {
    const ratio = (p: PlantCompleteness) => (p.totalSlots ? p.uploadedSlots / p.totalSlots : 0)
    const list =
      order === 'complete'
        ? [...plants].sort((a, b) => ratio(b) - ratio(a) || b.uploadedSlots - a.uploadedSlots || a.plant.localeCompare(b.plant))
        : [...plants].sort((a, b) => ratio(a) - ratio(b) || b.missingSlots - a.missingSlots || a.plant.localeCompare(b.plant))
    return showAll ? list : list.slice(0, 10)
  }, [plants, order, showAll])

  const t = totals
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>How complete each plant&apos;s documents are, by contract date.</p>
        </div>
        <div className="actions">
          <select className="select" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as DatePreset)}>
            {PERIODS.map(([k, l]) => (
              <option key={k} value={k}>
                Contract date: {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="kpis">
        <div className="panel kpi">
          <span>POs in this period</span>
          <b>{t ? t.contractCount.toLocaleString('en-US') : '…'}</b>
          <small>from the SAP import</small>
        </div>
        <div className="panel kpi">
          <span>With all 9 documents</span>
          <b>{t ? t.completeCount.toLocaleString('en-US') : '…'}</b>
          <small>{t ? `${pct(t.completeCount, t.contractCount)}% of POs` : ''}</small>
        </div>
        <div className="panel kpi">
          <span>Documents uploaded</span>
          <b style={{ color: t ? (t.completenessPct >= 80 ? 'var(--ok)' : t.completenessPct >= 50 ? 'var(--warn)' : 'var(--bad)') : undefined }}>
            {t ? `${t.completenessPct.toFixed(1)}%` : '…'}
          </b>
          <small>{t ? `${t.uploadedSlots.toLocaleString('en-US')} of ${t.totalSlots.toLocaleString('en-US')} slots (9 per PO)` : ''}</small>
        </div>
        <div className="panel kpi">
          <span>POs with nothing yet</span>
          <b style={{ color: 'var(--bad)' }}>{t ? t.emptyCount.toLocaleString('en-US') : '…'}</b>
          <small>need attention</small>
        </div>
      </div>
      <div className="split">
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '14px 16px 0', flexWrap: 'wrap' }}>
            <h3 style={{ padding: 0 }}>Completeness by plant</h3>
            <div className="chips">
              <button className="chip" type="button" aria-pressed={order === 'complete'} onClick={() => setOrder('complete')}>
                Most complete
              </button>
              <button className="chip" type="button" aria-pressed={order === 'gaps'} onClick={() => setOrder('gaps')}>
                Biggest gaps
              </button>
            </div>
          </div>
          {loading ? (
            <div style={{ padding: 16 }}>
              <Spinner />
            </div>
          ) : (
            <div className="plants">
              {sorted.map((p) => {
                const some = Math.max(0, p.contractCount - p.completeCount - p.emptyCount)
                const w = (n: number) => (p.contractCount ? `${(n / p.contractCount) * 100}%` : '0%')
                return (
                  <div className="plant" key={p.plant}>
                    <span className="nm">{p.plant}</span>
                    <div
                      className="track"
                      title={`${p.plant}: ${p.completeCount} with all 9, ${some} with some, ${p.emptyCount} with none`}
                    >
                      <i className="a" style={{ width: w(p.completeCount) }} />
                      <i className="b" style={{ width: w(some) }} />
                    </div>
                    <span className="val">
                      <b>{p.completenessPct.toFixed(1)}%</b> <span className="hint">{plural(p.contractCount, 'PO')}</span>
                    </span>
                  </div>
                )
              })}
              {!plants.length ? <p className="hint">No POs in this period.</p> : null}
            </div>
          )}
          <div className="legend">
            <span>
              <i style={{ background: 'var(--accent)' }} />
              All 9 documents
            </span>
            <span>
              <i style={{ background: '#8FC1C6' }} />
              Some documents
            </span>
            <span>
              <i style={{ background: 'var(--muted-bg)', border: '1px solid var(--line)' }} />
              Nothing yet
            </span>
            {plants.length > 10 ? (
              <button className="link" type="button" onClick={() => setShowAll((v) => !v)} style={{ marginLeft: 'auto' }}>
                {showAll ? 'Show top 10' : `Show all ${plants.length} plants`}
              </button>
            ) : null}
          </div>
        </div>
        {missing ? (
          <div className="panel">
            <h3>Most often missing</h3>
            <div className="mini">
              {missing.map((m) => (
                <div className="r" key={m.label}>
                  <span>{m.label}</span>
                  <b className="num">{plural(m.count, 'PO')}</b>
                </div>
              ))}
              <Link className="link" href="/documents" style={{ fontSize: 13 }}>
                Open Documents
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
