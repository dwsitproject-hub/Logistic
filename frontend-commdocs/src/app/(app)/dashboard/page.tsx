'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CompletenessRows } from '@/components/dashboard/CompletenessRows'
import { CreatorTable, type CreatorPayload } from '@/components/dashboard/CreatorTable'
import { ErrorNote, Spinner } from '@/components/ui'
import { apiData, errorMessage, isAbort, toQuery } from '@/lib/api'
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from '@/lib/documentTypes'
import { pct, plantLabel, plural, presetRange, type DatePreset } from '@/lib/format'
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
 * checklist slots out of POs x 11. The bars split each plant's POs into all eleven / some / none.
 */
export default function DashboardPage() {
  const { access, user } = useSession()
  const [period, setPeriod] = useState<DatePreset>('ytd')
  const [order, setOrder] = useState<'complete' | 'gaps'>('complete')
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<'plant' | 'user' | 'document'>('plant')
  const [creators, setCreators] = useState<CreatorPayload | null>(null)
  const [creatorsLoading, setCreatorsLoading] = useState(true)
  const [creatorsError, setCreatorsError] = useState('')
  const [plants, setPlants] = useState<PlantCompleteness[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  // The Documents summary (per type: POs in the period and POs with it uploaded): the "By document" view. It needs the Documents permission.
  const [summary, setSummary] = useState<Record<string, SummaryCard> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const range = useMemo(() => presetRange(period)!, [period])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError('')
    setCreatorsLoading(true)
    apiData<{ plants: PlantCompleteness[]; totals: Totals }>(
      `/commercial-documents/completeness-by-plant${toQuery(range)}`,
      { signal: ctrl.signal },
    )
      .then((d) => {
        // Only plants with a name: POs without a Region/Plant (the "Unassigned" bucket) are not listed. The KPIs above still count every PO.
        setPlants((d.plants || []).filter((p) => p.plant && p.plant !== 'Unassigned'))
        setTotals(d.totals || null)
        setLoading(false)
        // By user is fetched now, behind the plants, so the toggle shows it at once instead of a spinner. (After the plants, not with them: it is
        // the same heavy query and the cards and bars come first.)
        setCreatorsLoading(true)
        setCreatorsError('')
        apiData<CreatorPayload>(`/commercial-documents/completeness-by-creator${toQuery(range)}`, { signal: ctrl.signal })
          .then((c) => {
            setCreators(c)
            setCreatorsLoading(false)
          })
          .catch((err) => {
            if (isAbort(err)) return
            setCreatorsError(errorMessage(err, 'Could not load the users. Please try again.'))
            setCreatorsLoading(false)
          })
      })
      .catch((err) => {
        if (isAbort(err)) return
        setError(errorMessage(err, 'Could not load the dashboard. Please try again.'))
        setLoading(false)
      })
    // By document: the same summary as the cards on the Documents page, which needs the Documents permission.
    if (access.documents) {
      apiData<{ summary: Record<string, SummaryCard> }>(`/commercial-documents/summary${toQuery(range)}`, { signal: ctrl.signal })
        .then((d) => setSummary(d.summary || null))
        .catch(() => setSummary(null))
    }
    return () => ctrl.abort()
  }, [range, access.documents])

  const docRows = useMemo(() => {
    const rows = DOCUMENT_TYPES.map((type) => {
      const total = summary?.[type]?.totalCount ?? 0
      const uploaded = summary?.[type]?.uploadedCount ?? 0
      return { type, label: DOCUMENT_LABELS[type].toUpperCase(), total, uploaded, missing: Math.max(0, total - uploaded), pct: pct(uploaded, total) }
    })
    return order === 'complete' ? rows.sort((x, y) => y.pct - x.pct || x.missing - y.missing) : rows.sort((x, y) => y.missing - x.missing || x.pct - y.pct)
  }, [summary, order])

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
          <p>How complete the documents are, by plant, by SAP user or by document, by contract date.</p>
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
          <span>With all 11 documents</span>
          <b>{t ? t.completeCount.toLocaleString('en-US') : '…'}</b>
          <small>{t ? `${pct(t.completeCount, t.contractCount)}% of POs` : ''}</small>
        </div>
        <div className="panel kpi">
          <span>Documents uploaded</span>
          <b style={{ color: t ? (t.completenessPct >= 80 ? 'var(--ok)' : t.completenessPct >= 50 ? 'var(--warn)' : 'var(--bad)') : undefined }}>
            {t ? `${t.completenessPct.toFixed(1)}%` : '…'}
          </b>
          <small>{t ? `${t.uploadedSlots.toLocaleString('en-US')} of ${t.totalSlots.toLocaleString('en-US')} slots (11 per PO)` : ''}</small>
        </div>
        <div className="panel kpi">
          <span>POs with nothing yet</span>
          <b style={{ color: 'var(--bad)' }}>{t ? t.emptyCount.toLocaleString('en-US') : '…'}</b>
          <small>need attention</small>
        </div>
      </div>
      <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '14px 16px 0', flexWrap: 'wrap' }}>
            <h3 style={{ padding: 0 }}>Completeness</h3>
            <div className="chips" role="group" aria-label="Group completeness by">
              <button className="chip" type="button" aria-pressed={view === 'plant'} onClick={() => setView('plant')}>
                By plant
              </button>
              <button className="chip" type="button" aria-pressed={view === 'user'} onClick={() => setView('user')}>
                By user
              </button>
              {access.documents ? (
                <button className="chip" type="button" aria-pressed={view === 'document'} onClick={() => setView('document')}>
                  By document
                </button>
              ) : null}
            </div>
          </div>
          {view === 'user' ? (
            <CreatorTable payload={creators} loading={creatorsLoading} error={creatorsError} isAdmin={user?.role === 'ADMIN'} />
          ) : view === 'document' ? (
            <>
              <div style={{ padding: '10px 16px 0' }} className="chips">
                <button className="chip" type="button" aria-pressed={order === 'complete'} onClick={() => setOrder('complete')}>
                  Most complete
                </button>
                <button className="chip" type="button" aria-pressed={order === 'gaps'} onClick={() => setOrder('gaps')}>
                  Biggest gaps
                </button>
              </div>
              {summary ? (
                <div className="cr">
                  <div className="cr-row cr-docs cr-head">
                    <span>Document</span>
                    <span>POs with the document</span>
                    <span className="r">%</span>
                    <span className="r">POs with it</span>
                    <span className="r cr-hide">POs missing it</span>
                    <span className="r cr-hide">Total POs</span>
                  </div>
                  {docRows.map((d) => (
                    <div className="cr-row cr-docs" key={d.type} style={{ cursor: 'default' }}>
                      <span className="cr-name" title={d.label}>
                        <b>{d.label}</b>
                      </span>
                      <span className="track" title={`${d.label}: ${d.uploaded.toLocaleString('en-US')} of ${plural(d.total, 'PO')} have it, ${d.missing.toLocaleString('en-US')} do not`}>
                        <i className="a" style={{ width: `${d.pct}%` }} />
                      </span>
                      <span className="r">
                        <b>{d.pct.toFixed(1)}%</b>
                      </span>
                      <span className="r">{d.uploaded.toLocaleString('en-US')}</span>
                      <span className="r cr-hide" style={{ color: d.missing ? 'var(--bad)' : undefined }}>
                        {d.missing.toLocaleString('en-US')}
                      </span>
                      <span className="r cr-hide">{d.total.toLocaleString('en-US')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: 16 }}>
                  <Spinner />
                </div>
              )}
              <div className="legend">
                <span>
                  <i style={{ background: 'var(--accent)' }} />
                  POs with the document
                </span>
                <span>
                  <i style={{ background: 'var(--muted-bg)', border: '1px solid var(--line)' }} />
                  POs missing it
                </span>
                <Link className="link" href="/documents" style={{ marginLeft: 'auto' }}>
                  Open Documents
                </Link>
              </div>
            </>
          ) : (
            <>
              <div style={{ padding: '10px 16px 0' }} className="chips">
                <button className="chip" type="button" aria-pressed={order === 'complete'} onClick={() => setOrder('complete')}>
                  Most complete
                </button>
                <button className="chip" type="button" aria-pressed={order === 'gaps'} onClick={() => setOrder('gaps')}>
                  Biggest gaps
                </button>
              </div>
          {loading ? (
            <div style={{ padding: 16 }}>
              <Spinner />
            </div>
          ) : (
            <>
              <CompletenessRows
                firstLabel="Plant"
                rows={sorted.map((p) => ({
                  key: p.plant,
                  name: plantLabel(p.plant),
                  contractCount: p.contractCount,
                  completeCount: p.completeCount,
                  emptyCount: p.emptyCount,
                  completenessPct: p.completenessPct,
                  uploadedSlots: p.uploadedSlots,
                  totalSlots: p.totalSlots,
                  byType: p.byType,
                }))}
              />
              {!plants.length ? <p className="hint" style={{ padding: '0 16px' }}>No POs in this period.</p> : null}
            </>
          )}
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
            {plants.length > 10 ? (
              <button className="link" type="button" onClick={() => setShowAll((v) => !v)} style={{ marginLeft: 'auto' }}>
                {showAll ? 'Show top 10' : `Show all ${plants.length} plants`}
              </button>
            ) : null}
          </div>
            </>
          )}
      </div>
    </>
  )
}
