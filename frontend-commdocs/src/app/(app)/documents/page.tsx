'use client'

import { ArrowDownUp, ArrowDown, ArrowUp, Columns3, Filter, ReceiptText, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { COLUMNS, DEFAULT_VISIBLE } from '@/components/documents/columns'
import { DocumentDrawer } from '@/components/documents/DocumentDrawer'
import { TandaTerimaModal } from '@/components/documents/TandaTerimaModal'
import { ErrorNote, PageSize, Pager, Spinner, usePreference, useToast } from '@/components/ui'
import { apiData, errorMessage, isAbort, toQuery, type QueryValue } from '@/lib/api'
import { DOCUMENT_LABELS, DOCUMENT_TYPES, isDocumentType, type DocumentType } from '@/lib/documentTypes'
import { pct, plural, presetRange, type DatePreset } from '@/lib/format'
import { useSession } from '@/lib/session'
import type { ContractCounts, DocumentRow, Pagination, SummaryCard } from '@/lib/types'

/** null = all POs; 'incomplete' = short of all nine; a type = POs that have that type uploaded (a summary card). */
type DocFilter = null | 'incomplete' | DocumentType

type Filters = {
  preset: DatePreset
  from: string
  to: string
  plant: string
  incoterm: string
  products: string[]
  suppliers: string[]
}

const EMPTY_FILTERS: Filters = { preset: 'ytd', from: '', to: '', plant: '', incoterm: '', products: [], suppliers: [] }

const DATE_PRESETS: Array<[DatePreset, string]> = [
  ['ytd', 'This year'],
  ['last30', 'Last 30 days'],
  ['last90', 'Last 90 days'],
  ['lastYear', 'Last year'],
  ['all', 'All dates'],
  ['custom', 'Custom range…'],
]

type Options = { plants: string[]; incoterms: string[]; products: string[]; suppliers: string[] }

function asList(value: unknown, key: string): string[] {
  const list = Array.isArray(value) ? value : (value as Record<string, unknown> | null)?.[key]
  return Array.isArray(list) ? list.map(String).filter(Boolean) : []
}

export default function DocumentsPage() {
  const { access } = useSession()
  const { toast, lift } = useToast()

  // ---- filters ----
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [docFilter, setDocFilter] = useState<DocFilter>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [supplierQuery, setSupplierQuery] = useState('')
  const [options, setOptions] = useState<Options>({ plants: [], incoterms: [], products: [], suppliers: [] })

  // ---- table ----
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'contract_date', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePreference<number>('cd.pageSize', 10)
  const [savedCols, setSavedCols] = usePreference<Record<string, boolean>>('cd.columns', DEFAULT_VISIBLE)
  const [colsOpen, setColsOpen] = useState(false)
  const [rows, setRows] = useState<DocumentRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [summary, setSummary] = useState<Record<string, SummaryCard> | null>(null)
  const [counts, setCounts] = useState<ContractCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  // ---- drawer + Tanda Terima ----
  const [open, setOpen] = useState<DocumentRow | null>(null)
  const [selected, setSelected] = useState<Record<string, DocumentRow>>({})
  const [ttRows, setTtRows] = useState<DocumentRow[] | null>(null)
  const [ttFromDrawer, setTtFromDrawer] = useState(false)

  const cols = useMemo(() => ({ ...DEFAULT_VISIBLE, ...savedCols }), [savedCols])
  const visible = COLUMNS.filter((c) => c.fixed || cols[c.id])
  const selectedRows = Object.values(selected)

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // Any filter, search or card change starts again at page 1.
  useEffect(() => setPage(1), [search, filters, docFilter, pageSize])

  const range = useMemo(() => {
    if (filters.preset === 'custom') return { dateFrom: filters.from, dateTo: filters.to }
    return presetRange(filters.preset) || { dateFrom: '', dateTo: '' }
  }, [filters])

  const scope = useMemo<Record<string, QueryValue>>(
    () => ({
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      search,
      plant: filters.plant ? [filters.plant] : [],
      incoterm: filters.incoterm,
      product: filters.products,
      supplier: filters.suppliers,
    }),
    [range, search, filters],
  )
  const scopeQuery = toQuery(scope)

  const listParams = useCallback(
    (p: number, limit: number): Record<string, QueryValue> => ({
      ...scope,
      page: p,
      limit,
      sortKey: sort.key,
      sortDir: sort.dir,
      ...(docFilter === 'incomplete'
        ? { completeness: 'incomplete' }
        : docFilter
          ? { documentType: docFilter, documentStatus: 'checked' }
          : {}),
    }),
    [scope, sort, docFilter],
  )

  // Filter choices, once.
  useEffect(() => {
    const ctrl = new AbortController()
    const get = (path: string) => apiData<unknown>(path, { signal: ctrl.signal }).catch(() => null)
    void Promise.all([
      get('/contracts/filter-options/group-plants'),
      get('/contracts/filter-options/incoterms'),
      get('/dashboard/filter-options/products'),
      get('/dashboard/filter-options/suppliers'),
    ]).then(([plants, incoterms, products, suppliers]) =>
      setOptions({
        plants: asList(plants, 'groupPlants'),
        incoterms: asList(incoterms, 'incoterms'),
        products: asList(products, 'products'),
        suppliers: asList(suppliers, 'suppliers'),
      }),
    )
    return () => ctrl.abort()
  }, [])

  // The table.
  useEffect(() => {
    if (filters.preset === 'custom' && (!filters.from || !filters.to)) return
    const ctrl = new AbortController()
    setLoading(true)
    setError('')
    apiData<{ rows: DocumentRow[]; pagination: Pagination }>(`/commercial-documents${toQuery(listParams(page, pageSize))}`, {
      signal: ctrl.signal,
    })
      .then((d) => {
        const fresh = d.rows || []
        setRows(fresh)
        setPagination(d.pagination)
        setLoading(false)
        // After an upload or delete the reloaded rows carry new checklist flags: keep the open drawer's and the selection's
        // copies of the same POs current.
        const byId = new Map(fresh.map((r) => [r.id, r]))
        setOpen((cur) => (cur && byId.has(cur.id) ? byId.get(cur.id)! : cur))
        setSelected((cur) => {
          let next: Record<string, DocumentRow> | null = null
          for (const id of Object.keys(cur)) {
            const r = byId.get(id)
            if (r && r !== cur[id]) (next ??= { ...cur })[id] = r
          }
          return next ?? cur
        })
      })
      .catch((err) => {
        if (isAbort(err)) return
        setError(errorMessage(err, 'Could not load the POs. Please try again.'))
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [listParams, page, pageSize, reload, filters.preset, filters.from, filters.to])

  // The cards and chip counts follow the scope (not the card / chip itself).
  useEffect(() => {
    if (filters.preset === 'custom' && (!filters.from || !filters.to)) return
    const ctrl = new AbortController()
    apiData<{ summary: Record<string, SummaryCard>; contracts?: ContractCounts }>(`/commercial-documents/summary${scopeQuery}`, {
      signal: ctrl.signal,
    })
      .then((d) => {
        setSummary(d.summary)
        setCounts(d.contracts ?? null)
      })
      .catch(() => undefined)
    return () => ctrl.abort()
  }, [scopeQuery, reload, filters.preset, filters.from, filters.to])

  // Keep the floating selection bar and toasts from overlapping.
  const barShown = selectedRows.length > 0 && !open && !ttRows
  useEffect(() => {
    lift(barShown)
    return () => lift(false)
  }, [barShown, lift])

  // Close the Columns menu on an outside click.
  const colsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!colsOpen) return
    const onDown = (e: globalThis.MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [colsOpen])

  const setF = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const resetAll = () => {
    setSearchInput('')
    setSearch('')
    setFilters(EMPTY_FILTERS)
    setDocFilter(null)
    setSupplierQuery('')
  }

  const sortBy = (key: string, numeric?: boolean) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: numeric ? 'desc' : 'asc' }))

  const pageAllSelected = rows.length > 0 && rows.every((r) => selected[r.id])
  const pageSomeSelected = rows.some((r) => selected[r.id])
  const toggleRow = (r: DocumentRow) =>
    setSelected((s) => {
      const next = { ...s }
      if (next[r.id]) delete next[r.id]
      else next[r.id] = r
      return next
    })
  const togglePage = () =>
    setSelected((s) => {
      const next = { ...s }
      if (pageAllSelected) rows.forEach((r) => delete next[r.id])
      else rows.forEach((r) => (next[r.id] = r))
      return next
    })

  const fchips: Array<[string, string, () => void]> = [
    ...(search ? [['q', `Search: ${search}`, () => (setSearchInput(''), setSearch(''))] as [string, string, () => void]] : []),
    ...filters.products.map(
      (p) => [`p:${p}`, `Product: ${p}`, () => setF({ products: filters.products.filter((x) => x !== p) })] as [string, string, () => void],
    ),
    ...filters.suppliers.map(
      (s) => [`s:${s}`, `Supplier: ${s}`, () => setF({ suppliers: filters.suppliers.filter((x) => x !== s) })] as [string, string, () => void],
    ),
  ]
  const moreCount = filters.products.length + filters.suppliers.length
  const total = pagination?.total ?? 0
  const pages = Math.max(1, pagination?.totalPages ?? 1)
  const from = total ? (page - 1) * pageSize + 1 : 0
  const contractsInScope = counts?.totalCount ?? summary?.contract?.totalCount ?? null

  const openRow = (e: MouseEvent, r: DocumentRow) => {
    if ((e.target as HTMLElement).closest('.ck')) return
    setOpen(r)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Documents</h1>
          <p>One row per PO from SAP. Click a row to check, upload and view its documents.</p>
        </div>
      </div>

      <div className="panel">
        <div className="filters">
          <div className="input-ic">
            <Search aria-hidden />
            <input
              className="input"
              placeholder="Search PO, contract or supplier"
              aria-label="Search PO, contract or supplier"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select
            className="select"
            aria-label="Contract date"
            value={filters.preset}
            onChange={(e) => {
              const preset = e.target.value as DatePreset
              const r = presetRange(filters.preset) || { dateFrom: '', dateTo: '' }
              setF(preset === 'custom' ? { preset, from: filters.from || r.dateFrom, to: filters.to || r.dateTo } : { preset })
            }}
          >
            {DATE_PRESETS.map(([k, l]) => (
              <option key={k} value={k}>
                Contract date: {l}
              </option>
            ))}
          </select>
          {filters.preset === 'custom' ? (
            <div className="daterange">
              <input className="input" type="date" aria-label="From" value={filters.from} onChange={(e) => setF({ from: e.target.value })} />
              <span className="hint">to</span>
              <input className="input" type="date" aria-label="To" value={filters.to} onChange={(e) => setF({ to: e.target.value })} />
            </div>
          ) : null}
          <select className="select" aria-label="Region/Plant" value={filters.plant} onChange={(e) => setF({ plant: e.target.value })}>
            <option value="">Region/Plant: All</option>
            {options.plants.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Incoterm" value={filters.incoterm} onChange={(e) => setF({ incoterm: e.target.value })}>
            <option value="">Incoterm: All</option>
            {options.incoterms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button className={`btn${moreOpen ? '' : ' ghost'}`} type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
            <Filter aria-hidden />
            More filters
            {moreCount ? <span className="badge num">{moreCount}</span> : null}
          </button>
        </div>
        {moreOpen ? (
          <div className="more">
            <div className="field">
              <span className="flabel">Product</span>
              <div className="optlist scroll">
                {options.products.map((p) => (
                  <label className="opt" key={p}>
                    <input type="checkbox" checked={filters.products.includes(p)} onChange={() => setF({ products: toggleIn(filters.products, p) })} />{' '}
                    {p}
                  </label>
                ))}
                {!options.products.length ? <span className="hint">No products.</span> : null}
              </div>
            </div>
            <div className="field">
              <span className="flabel">Supplier</span>
              <div className="input-ic" style={{ marginBottom: 6 }}>
                <Search aria-hidden />
                <input
                  className="input"
                  placeholder="Search supplier"
                  aria-label="Search supplier"
                  value={supplierQuery}
                  onChange={(e) => setSupplierQuery(e.target.value)}
                  style={{ height: 34 }}
                />
              </div>
              <div className="optlist scroll">
                {options.suppliers
                  .filter((s) => !supplierQuery || s.toLowerCase().includes(supplierQuery.toLowerCase()))
                  .slice(0, 300)
                  .map((s) => (
                    <label className="opt" key={s}>
                      <input
                        type="checkbox"
                        checked={filters.suppliers.includes(s)}
                        onChange={() => setF({ suppliers: toggleIn(filters.suppliers, s) })}
                      />{' '}
                      {s}
                    </label>
                  ))}
              </div>
            </div>
          </div>
        ) : null}
        {fchips.length ? (
          <div className="fchips">
            <span className="hint">Filtered by</span>
            {fchips.map(([k, label, remove]) => (
              <span className="fchip" key={k}>
                {label}
                <button type="button" onClick={remove} aria-label={`Remove ${label}`}>
                  <X aria-hidden />
                </button>
              </span>
            ))}
            <button className="link" type="button" onClick={resetAll}>
              Reset all
            </button>
          </div>
        ) : null}
        <div className="chips" style={{ padding: '0 12px 12px' }}>
          <button className="chip" type="button" aria-pressed={docFilter === null} onClick={() => setDocFilter(null)}>
            All POs <b>{contractsInScope === null ? '…' : contractsInScope.toLocaleString('en-US')}</b>
          </button>
          <button
            className="chip"
            type="button"
            aria-pressed={docFilter === 'incomplete'}
            onClick={() => setDocFilter(docFilter === 'incomplete' ? null : 'incomplete')}
          >
            Incomplete <b>{counts ? counts.incompleteCount.toLocaleString('en-US') : '…'}</b>
          </button>
        </div>
      </div>

      <section className="sumcards-wrap" aria-label="Documents uploaded per type">
        <p className="hint">
          Contracts with the document uploaded, out of all contracts in the selected date range. Click a card to list them in the table
          below.
        </p>
        <div className="sumcards">
          {DOCUMENT_TYPES.map((t) => {
            const c = summary?.[t]
            const p = c ? pct(c.uploadedCount, c.totalCount) : 0
            return (
              <button
                key={t}
                type="button"
                className="sumcard"
                aria-pressed={docFilter === t}
                title={`Show contracts with ${DOCUMENT_LABELS[t]} uploaded`}
                onClick={() => setDocFilter(docFilter === t ? null : t)}
              >
                <span className="sc-l">{DOCUMENT_LABELS[t]}</span>
                <span className="sc-k">Contract</span>
                <span className="sc-n num">
                  {c ? `${c.uploadedCount.toLocaleString('en-US')}/${c.totalCount.toLocaleString('en-US')}` : '…'}
                </span>
                <span className={`sc-p num ${p >= 75 ? 'good' : p >= 40 ? 'mid' : 'low'}`}>{c ? `${p.toFixed(1)}%` : ''}</span>
                <span className="sc-bar" aria-hidden>
                  <i style={{ width: `${p}%` }} />
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="panel">
        <div className="tbl-tools">
          <span className="hint">
            {docFilter && isDocumentType(docFilter)
              ? `Showing POs with ${DOCUMENT_LABELS[docFilter]} uploaded · `
              : docFilter === 'incomplete'
                ? 'Showing POs that miss at least one document · '
                : ''}
            Tick the boxes on the right to download one Tanda Terima for several POs
          </span>
          <div className="actions">
            <div className="colpick" ref={colsRef}>
              <button className="btn sm" type="button" onClick={() => setColsOpen((v) => !v)} aria-expanded={colsOpen} aria-haspopup="true">
                <Columns3 aria-hidden />
                Columns{' '}
                <span className="badge num">
                  {visible.length}/{COLUMNS.length}
                </span>
              </button>
              {colsOpen ? (
                <div className="colmenu" role="menu" aria-label="Show or hide columns">
                  <div className="cm-head">
                    <b>Show columns</b>
                    <button className="link" type="button" onClick={() => setSavedCols(DEFAULT_VISIBLE)}>
                      Reset
                    </button>
                  </div>
                  {COLUMNS.map((c) => (
                    <label className="cm-item" key={c.id}>
                      <input
                        type="checkbox"
                        checked={Boolean(c.fixed || cols[c.id])}
                        disabled={c.fixed}
                        onChange={(e) => setSavedCols({ ...cols, [c.id]: e.target.checked })}
                      />{' '}
                      {c.label}
                      {c.fixed ? <span className="hint">(always)</span> : null}
                    </label>
                  ))}
                  <p className="hint" style={{ margin: '6px 2px 0' }}>
                    Your choice is remembered on this browser.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <ErrorNote onRetry={() => setReload((n) => n + 1)}>{error}</ErrorNote>
        <div className="tbl-wrap">
          {loading ? (
            <div className="loading-veil">
              <Spinner />
            </div>
          ) : null}
          <table>
            <thead>
              <tr>
                {visible.map((c) => (
                  <th key={c.id} className={c.numeric ? 'num' : undefined}>
                    {c.sortKey ? (
                      <button
                        type="button"
                        className="sort"
                        data-active={sort.key === c.sortKey}
                        onClick={() => sortBy(c.sortKey!, c.numeric)}
                        aria-label={`Sort by ${c.label}`}
                      >
                        {c.label}
                        {sort.key === c.sortKey ? (
                          sort.dir === 'asc' ? (
                            <ArrowUp aria-hidden />
                          ) : (
                            <ArrowDown aria-hidden />
                          )
                        ) : (
                          <ArrowDownUp aria-hidden />
                        )}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
                <th className="ck" title="Select POs for a Tanda Terima">
                  <input
                    type="checkbox"
                    aria-label="Select all POs on this page for a Tanda Terima"
                    checked={pageAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = pageSomeSelected && !pageAllSelected
                    }}
                    onChange={togglePage}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`clickable${selected[r.id] ? ' picked' : ''}`} onClick={(e) => openRow(e, r)}>
                  {visible.map((c) => (
                    <td key={c.id} className={c.numeric ? 'num' : undefined}>
                      {c.cell(r)}
                    </td>
                  ))}
                  <td className="ck">
                    <input
                      type="checkbox"
                      aria-label={`Select PO ${r.po_number || r.contract_ext_no}`}
                      checked={Boolean(selected[r.id])}
                      onChange={() => toggleRow(r)}
                    />
                  </td>
                </tr>
              ))}
              {!rows.length && !loading ? (
                <tr>
                  <td className="empty" colSpan={visible.length + 1}>
                    No PO matches these filters. Clear the search or pick another card.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="tbl-foot">
          <div className="pp">
            <PageSize value={pageSize} onChange={setPageSize} />
            <span className="num">{total ? `${from}–${from + rows.length - 1} of ${plural(total, 'PO')}` : '0 POs'}</span>
          </div>
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>
      </div>

      {barShown ? (
        <div className="fbar" role="region" aria-label="Tanda Terima selection">
          <span>
            <b>{selectedRows.length}</b> PO{selectedRows.length === 1 ? '' : 's'} selected{' '}
            <span className="hint">· kept across pages and filters</span>
          </span>
          <button
            className="btn primary sm"
            type="button"
            onClick={() => {
              setTtFromDrawer(false)
              setTtRows(selectedRows)
            }}
          >
            <ReceiptText aria-hidden />
            Download Tanda Terima
          </button>
          <button className="icon-btn" type="button" onClick={() => setSelected({})} title="Clear selection" aria-label="Clear selection">
            <X aria-hidden />
          </button>
        </div>
      ) : null}

      {open ? (
        <DocumentDrawer
          row={open}
          access={access}
          onClose={() => setOpen(null)}
          onChanged={() => setReload((n) => n + 1)}
          onTandaTerima={(r) => {
            setTtFromDrawer(true)
            setTtRows([r])
          }}
        />
      ) : null}

      {ttRows ? (
        <TandaTerimaModal
          rows={ttFromDrawer ? ttRows : selectedRows}
          removable={!ttFromDrawer}
          onRemove={(r) => toggleRow(r)}
          onClose={() => setTtRows(null)}
          onDone={(n) => {
            setTtRows(null)
            toast(`Tanda Terima PDF downloaded for ${plural(n, 'PO')}`)
          }}
        />
      ) : null}
    </>
  )
}
