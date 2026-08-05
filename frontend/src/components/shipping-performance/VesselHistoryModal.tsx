'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatAvgDays, formatSignedDeltaDays, signedCycleDaysClass } from '@/lib/cycleDaysDisplay'
import {
  aggregateShippingPerfVesselModalBySto,
  formatShippingPerfVesselModalDate,
  formatShippingPerfVesselModalQtyMt,
  isVesselModalHistoryDeltaColumn,
  isVesselModalOpenDeltaColumn,
  partitionShippingPerfVesselModalRows,
  resolveVesselModalHistoryDeltaDays,
  resolveVesselModalOpenDeltaDays,
  sortShippingPerfVesselModalRows,
  VESSEL_MODAL_HISTORY_COLUMNS,
  VESSEL_MODAL_OPEN_COLUMNS,
  type ShippingPerfVesselModalAggregatedRow,
  type ShippingPerfVesselModalSourceRow,
  type VesselModalHistoryColumnKey,
  type VesselModalOpenColumnKey,
} from '@/lib/shippingPerformanceVesselModal'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { formatShipmentStatusLabel, shipmentStatusBadgeClass } from '@/lib/shipmentStatusDisplay'
import { cn } from '@/lib/utils'
import { computeROilLossSummary } from '@/lib/oilLossSummary'
import { filterOilLossEligibleRows } from '@/lib/oilLossEligibility'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import { Anchor, Loader2, Ship, X } from 'lucide-react'

export type VesselHistoryModalSelection = {
  vesselName: string
  vesselKey: string
}

/** Row shape passed from Shipping Performance page only. */
export type VesselHistoryShipmentRow = ShippingPerfVesselModalSourceRow

type MasterVesselProfile = {
  vessel_code: string | null
  vessel_owner_group: string | null
  vessel_owner: string | null
  vessel_capacity_mt: number | null
  hull_type: string | null
  lambung_type: string | null
}

type VesselHistoryModalProps = {
  open: boolean
  onClose: () => void
  selection: VesselHistoryModalSelection | null
  /** Shipment rows in page scope (Open + Close); not limited by summary-card filter. */
  sourceRows: VesselHistoryShipmentRow[]
}

const VESSEL_ATA_AVG_METRICS = [
  { label: 'Avg Load (ATA-ATR)', key: 'ata_loading_delta_eta_etr_days' as const },
  { label: 'Avg Load (ATA-ATB)', key: 'ata_loading_delta_eta_etb_days' as const },
  { label: 'Avg Load (ATB-ATC)', key: 'ata_loading_delta_etb_etc_days' as const },
  { label: 'Avg Discharge (ATA-ATB)', key: 'ata_discharge_delta_eta_etb_days' as const },
  { label: 'Avg Discharge (ATB-ATC)', key: 'ata_discharge_delta_etb_etc_days' as const },
  { label: 'Avg Total', key: 'ata_total_delta_days' as const, spanFull: true },
] satisfies ReadonlyArray<{
  label: string
  key: keyof VesselHistoryShipmentRow
  spanFull?: boolean
}>

function normalizeVesselKey(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || 'Unknown'
}

function normalizeVesselNameForMatch(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function parseMasterVesselCapacityMt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function findMasterVesselByName<T extends { vessel_name?: string | null }>(
  items: T[],
  vesselName: string,
): T | undefined {
  const target = normalizeVesselNameForMatch(vesselName)
  if (!target) return undefined
  return items.find((v) => normalizeVesselNameForMatch(v.vessel_name) === target)
}

function formatVesselModalTitle(
  vesselCode: string | null | undefined,
  vesselName: string,
): string {
  const code = String(vesselCode ?? '').trim()
  const name = String(vesselName ?? '').trim()
  if (code && name) return `${code} - ${name}`
  return name || code || 'Unknown'
}

function displayLabel(value: unknown, fallback = '-'): string {
  return formatSapDisplayValue(value, fallback)
}

/** Postgres `numeric` columns (e.g. TC vessel metrics) arrive as strings — coerce, don't reject. */
function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function avgAtaDelta(
  rows: VesselHistoryShipmentRow[],
  key: keyof VesselHistoryShipmentRow,
): number | null {
  const vals = rows
    .map((r) => toFiniteNumber(r[key]))
    .filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  const avg = vals.reduce((sum, v) => sum + v, 0) / vals.length
  return Math.round(avg * 10) / 10
}

/** Port flow rate for one row = shipped MT / berth→complete days (actual). FOB→Delivered, else→Received. */
function rowPortFlowRate(row: VesselHistoryShipmentRow, port: 'lp' | 'dp'): number | null {
  const isFob = String(row.incoterm ?? '').trim().toUpperCase() === 'FOB'
  const numeratorKg = isFob ? row.delivered_qty : row.received_qty
  const delta =
    port === 'lp' ? row.ata_loading_delta_etb_etc_days : row.ata_discharge_delta_etb_etc_days
  const days = typeof delta === 'number' && Number.isFinite(delta) ? -delta : null
  if (days === null || days <= 0) return null
  if (typeof numeratorKg !== 'number' || !Number.isFinite(numeratorKg)) return null
  return numeratorKg / 1000 / days
}

/** Vessel average of the per-shipment flow rate (nulls excluded). */
function avgVesselFlowRate(rows: VesselHistoryShipmentRow[], port: 'lp' | 'dp'): number | null {
  const vals = rows
    .map((r) => rowPortFlowRate(r, port))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (vals.length === 0) return null
  return Math.round((vals.reduce((sum, v) => sum + v, 0) / vals.length) * 10) / 10
}

function formatFlowRate1(v: number | null): string {
  return v == null || !Number.isFinite(v)
    ? '-'
    : v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function formatPct1(v: number | null): string {
  return v == null || !Number.isFinite(v) ? '-' : `${v.toFixed(1)}%`
}

function formatMt1(v: number | null): string {
  return v == null || !Number.isFinite(v)
    ? '-'
    : `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MT`
}

const TC_VESSEL_METRIC_COLUMN_KEYS = new Set<VesselModalOpenColumnKey | VesselModalHistoryColumnKey>([
  'fuel_consumption',
  'freight',
  'pump_rate',
  'sailing_speed',
  'shortage',
])

function isTcVesselMetricColumn(
  key: VesselModalOpenColumnKey | VesselModalHistoryColumnKey,
): boolean {
  return TC_VESSEL_METRIC_COLUMN_KEYS.has(key)
}

function formatTcVesselMetric(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function renderDeltaDaysCell(days: number | null) {
  if (days == null || !Number.isFinite(days)) {
    return <span className="text-gray-400">-</span>
  }
  return (
    <span className={cn('font-semibold tabular-nums', signedCycleDaysClass(days))}>
      {formatSignedDeltaDays(days)} days
    </span>
  )
}

function renderOpenCell(row: ShippingPerfVesselModalAggregatedRow, key: VesselModalOpenColumnKey) {
  if (key === 'sto') {
    return <span>{displayLabel(row.sto)}</span>
  }
  if (key === 'contract_date') {
    return <span>{formatShippingPerfVesselModalDate(row.contract_date)}</span>
  }
  if (key === 'delivered_qty' || key === 'received_qty') {
    return <span>{formatShippingPerfVesselModalQtyMt(row[key])}</span>
  }
  if (key === 'status') {
    const status = String(row.status ?? '').trim()
    if (!status) return <span className="text-gray-400">-</span>
    return <Badge className={shipmentStatusBadgeClass(status)}>{formatShipmentStatusLabel(status)}</Badge>
  }
  if (isVesselModalOpenDeltaColumn(key)) {
    return renderDeltaDaysCell(resolveVesselModalOpenDeltaDays(row, key))
  }
  if (isTcVesselMetricColumn(key)) {
    return <span className="tabular-nums">{formatTcVesselMetric(row[key])}</span>
  }
  return <span>{displayLabel(row[key])}</span>
}

function renderHistoryCell(row: ShippingPerfVesselModalAggregatedRow, key: VesselModalHistoryColumnKey) {
  if (key === 'sto') {
    return <span>{displayLabel(row.sto)}</span>
  }
  if (key === 'contract_date') {
    return <span>{formatShippingPerfVesselModalDate(row.contract_date)}</span>
  }
  if (key === 'delivered_qty' || key === 'received_qty') {
    return <span>{formatShippingPerfVesselModalQtyMt(row[key])}</span>
  }
  if (key === 'status') {
    const status = String(row.status ?? '').trim()
    if (!status) return <span className="text-gray-400">-</span>
    return <Badge className={shipmentStatusBadgeClass(status)}>{formatShipmentStatusLabel(status)}</Badge>
  }
  if (isVesselModalHistoryDeltaColumn(key)) {
    return renderDeltaDaysCell(resolveVesselModalHistoryDeltaDays(row, key))
  }
  if (isTcVesselMetricColumn(key)) {
    return <span className="tabular-nums">{formatTcVesselMetric(row[key])}</span>
  }
  return <span>{displayLabel(row[key])}</span>
}

function VesselModalOpenTable({
  rows,
  emptyMessage,
}: {
  rows: ShippingPerfVesselModalAggregatedRow[]
  emptyMessage: string
}) {
  if (rows.length === 0) {
    return (
      <div className="flex max-h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-10 text-center text-sm text-gray-500">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="max-h-64 overflow-hidden rounded-lg border border-gray-200">
      <div className="max-h-64 overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="sticky top-0 z-[1] bg-gray-100">
            <tr>
              {VESSEL_MODAL_OPEN_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 font-medium text-gray-600',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50">
                {VESSEL_MODAL_OPEN_COLUMNS.map((col) => (
                  <td
                    key={`${row.id}-${col.key}`}
                    className={cn(
                      'whitespace-nowrap px-3 py-2',
                      col.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {renderOpenCell(row, col.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VesselModalHistoryTable({
  rows,
  emptyMessage,
}: {
  rows: ShippingPerfVesselModalAggregatedRow[]
  emptyMessage: string
}) {
  if (rows.length === 0) {
    return (
      <div className="flex max-h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-10 text-center text-sm text-gray-500">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="max-h-64 overflow-hidden rounded-lg border border-gray-200">
      <div className="max-h-64 overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="sticky top-0 z-[1] bg-gray-100">
            <tr>
              {VESSEL_MODAL_HISTORY_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 font-medium text-gray-600',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50">
                {VESSEL_MODAL_HISTORY_COLUMNS.map((col) => (
                  <td
                    key={`${row.id}-${col.key}`}
                    className={cn(
                      'whitespace-nowrap px-3 py-2',
                      col.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {renderHistoryCell(row, col.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VesselAtaAveragesGrid({ historyShipments }: { historyShipments: VesselHistoryShipmentRow[] }) {
  if (historyShipments.length === 0) {
    return (
      <p className="text-center text-xs italic text-gray-400">
        No completed or cancelled shipments — performance averages unavailable
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-2">
      {VESSEL_ATA_AVG_METRICS.map((metric) => {
        const value = avgAtaDelta(historyShipments, metric.key)
        return (
          <div
            key={metric.key}
            className={cn('flex min-w-0 flex-col gap-0.5', metric.spanFull && 'col-span-2 mt-1')}
          >
            <span
              className="truncate text-[10px] leading-tight text-gray-500"
              title={metric.label}
            >
              {metric.label}
            </span>
            <span
              className={cn(
                'text-[11px] font-bold tabular-nums text-gray-900',
                signedCycleDaysClass(value),
              )}
            >
              {formatAvgDays(value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function VesselHistoryModal({
  open,
  onClose,
  selection,
  sourceRows,
}: VesselHistoryModalProps) {
  const [profile, setProfile] = useState<MasterVesselProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [oilLossRows, setOilLossRows] = useState<OilLossSourceRow[]>([])
  const [oilLossLoading, setOilLossLoading] = useState(false)

  const vesselRows = useMemo(() => {
    if (!selection) return []
    return sourceRows.filter(
      (row) => normalizeVesselKey(row.vessel_name) === selection.vesselKey,
    )
  }, [sourceRows, selection])

  // Vessel-average LP/DP flow rate (self-contained; matches the By-Vessel / table columns).
  const avgLpFlowRate = useMemo(() => avgVesselFlowRate(vesselRows, 'lp'), [vesselRows])
  const avgDpFlowRate = useMemo(() => avgVesselFlowRate(vesselRows, 'dp'), [vesselRows])

  // TC vessel performance metrics — averaged across whatever shipments are in scope (all statuses),
  // matching the By Vessel table's aggregateByVessel treatment (not restricted to Closed only).
  const avgTcMetrics = useMemo(
    () => ({
      fuel_consumption: avgAtaDelta(vesselRows, 'fuel_consumption'),
      freight: avgAtaDelta(vesselRows, 'freight'),
      pump_rate: avgAtaDelta(vesselRows, 'pump_rate'),
      sailing_speed: avgAtaDelta(vesselRows, 'sailing_speed'),
      shortage: avgAtaDelta(vesselRows, 'shortage'),
    }),
    [vesselRows],
  )

  // Per-vessel oil-loss R1-R4 (% and MT), from the same /api/oil-loss data the Oil Loss page uses.
  const vesselOilLoss = useMemo(() => {
    const target = normalizeVesselNameForMatch(selection?.vesselName)
    const rows = target
      ? oilLossRows.filter((r) => normalizeVesselNameForMatch(r.vessel_name) === target)
      : []
    return {
      rowCount: rows.length,
      r1: computeROilLossSummary(rows, 'r1'),
      r2: computeROilLossSummary(rows, 'r2'),
      r3: computeROilLossSummary(rows, 'r3'),
      r4: computeROilLossSummary(rows, 'r4'),
    }
  }, [oilLossRows, selection])

  const { nextShipmentRows, onGoingRows, historyRows, historySourceRows } = useMemo(() => {
    const partitioned = partitionShippingPerfVesselModalRows(vesselRows)
    return {
      nextShipmentRows: sortShippingPerfVesselModalRows(
        aggregateShippingPerfVesselModalBySto(partitioned.nextShipment),
      ),
      onGoingRows: sortShippingPerfVesselModalRows(
        aggregateShippingPerfVesselModalBySto(partitioned.onGoing),
      ),
      historyRows: sortShippingPerfVesselModalRows(
        aggregateShippingPerfVesselModalBySto(partitioned.history),
      ),
      historySourceRows: partitioned.history,
    }
  }, [vesselRows])

  const fetchVesselProfile = useCallback(async (vesselName: string) => {
    setProfileLoading(true)
    setProfile(null)
    try {
      const res = await api.get('/master-vessels', {
        params: { search: vesselName.trim(), limit: 20 },
      })
      const items = (res.data?.data?.items ?? []) as Array<
        MasterVesselProfile & { vessel_name?: string }
      >
      const exact = findMasterVesselByName(items, vesselName)
      if (exact) {
        setProfile({
          vessel_code: exact.vessel_code ?? null,
          vessel_owner_group: exact.vessel_owner_group ?? null,
          vessel_owner: exact.vessel_owner ?? null,
          vessel_capacity_mt: parseMasterVesselCapacityMt(exact.vessel_capacity_mt),
          hull_type: exact.hull_type ?? null,
          lambung_type: exact.lambung_type ?? null,
        })
      }
    } catch (error) {
      console.error('Failed to load vessel master profile:', error)
    } finally {
      setProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !selection) return
    void fetchVesselProfile(selection.vesselName)
  }, [open, selection, fetchVesselProfile])

  // Load closed-contract oil-loss data once per open; filtered to the vessel client-side.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setOilLossLoading(true)
    api
      .get('/oil-loss')
      .then((r) => {
        if (cancelled) return
        const raw = Array.isArray(r.data?.data) ? (r.data.data as OilLossSourceRow[]) : []
        setOilLossRows(filterOilLossEligibleRows(raw))
      })
      .catch((error) => {
        console.error('Failed to load oil loss for vessel modal:', error)
      })
      .finally(() => {
        if (!cancelled) setOilLossLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open || !selection) return null

  const vesselTitle = formatVesselModalTitle(profile?.vessel_code, selection.vesselName)

  const profileFields: Array<{ label: string; value: string }> = [
    { label: 'Owner Group', value: displayLabel(profile?.vessel_owner_group) },
    { label: 'Owner', value: displayLabel(profile?.vessel_owner) },
    {
      label: 'Capacity',
      value:
        profile?.vessel_capacity_mt != null
          ? profile.vessel_capacity_mt.toLocaleString('en-US', { maximumFractionDigits: 2 })
          : '-',
    },
    { label: 'Hull Type', value: displayLabel(profile?.hull_type) },
    { label: 'Lambung Type', value: displayLabel(profile?.lambung_type) },
  ]

  const totalRecords = nextShipmentRows.length + onGoingRows.length + historyRows.length

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
        <div className="sticky top-0 z-10 shrink-0 rounded-t-lg border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                <Ship className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold text-gray-900" title={vesselTitle}>
                  {vesselTitle}
                </h3>
                <p className="text-xs text-gray-500">
                  {nextShipmentRows.length.toLocaleString('en-US')} next ·{' '}
                  {onGoingRows.length.toLocaleString('en-US')} on going ·{' '}
                  {historyRows.length.toLocaleString('en-US')} history ·{' '}
                  {totalRecords.toLocaleString('en-US')} STO groups in scope
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="sticky top-4 shrink-0 text-gray-400 hover:text-gray-600"
              aria-label="Close"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <section className="mb-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Anchor className="h-4 w-4 text-blue-600" />
              Vessel profile & performance
            </div>
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-gray-50/40 p-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Profile
                </div>
                {profileLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading master data...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {profileFields.map((field) => (
                      <div key={field.label}>
                        <div className="text-xs font-medium text-gray-500">{field.label}</div>
                        <div className="mt-0.5 text-sm font-semibold text-gray-900">{field.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="min-w-0 border-t border-gray-200 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Close performance averages (ATA)
                </div>
                <VesselAtaAveragesGrid historyShipments={historySourceRows} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-gray-50/40 p-4 lg:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Flow rate &amp; oil loss (vessel average)
                  {oilLossLoading ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" /> : null}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                  {[
                    { label: 'Avg LP Flow Rate', value: formatFlowRate1(avgLpFlowRate) },
                    { label: 'Avg DP Flow Rate', value: formatFlowRate1(avgDpFlowRate) },
                    {
                      label: 'Avg R1 Oil Loss',
                      value: `${formatPct1(vesselOilLoss.r1.avgPct)} · ${formatMt1(vesselOilLoss.r1.avgMt)}`,
                    },
                    {
                      label: 'Avg R2 Oil Loss',
                      value: `${formatPct1(vesselOilLoss.r2.avgPct)} · ${formatMt1(vesselOilLoss.r2.avgMt)}`,
                    },
                    {
                      label: 'Avg R3 Oil Loss',
                      value: `${formatPct1(vesselOilLoss.r3.avgPct)} · ${formatMt1(vesselOilLoss.r3.avgMt)}`,
                    },
                    {
                      label: 'Avg R4 Oil Loss',
                      value: `${formatPct1(vesselOilLoss.r4.avgPct)} · ${formatMt1(vesselOilLoss.r4.avgMt)}`,
                    },
                  ].map((metric) => (
                    <div key={metric.label} className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className="truncate text-[10px] leading-tight text-gray-500"
                        title={metric.label}
                      >
                        {metric.label}
                      </span>
                      <span className="text-[11px] font-bold tabular-nums text-gray-900">
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-snug text-gray-400">
                  Flow rate = MT ÷ berth→complete days (FOB: Delivered, CIF/CFR: Received).
                  Oil loss shown as avg % · avg MT across the vessel&apos;s closed contracts.
                </p>
              </div>
              <div className="min-w-0 border-t border-gray-200 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  TC Vessel Performance (avg)
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                  {[
                    { label: 'Fuel Consumption', value: formatTcVesselMetric(avgTcMetrics.fuel_consumption) },
                    { label: 'Freight', value: formatTcVesselMetric(avgTcMetrics.freight) },
                    { label: 'Pump Rate', value: formatTcVesselMetric(avgTcMetrics.pump_rate) },
                    { label: 'Sailing Speed', value: formatTcVesselMetric(avgTcMetrics.sailing_speed) },
                    { label: 'Shortage', value: formatTcVesselMetric(avgTcMetrics.shortage) },
                  ].map((metric) => (
                    <div key={metric.label} className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[10px] leading-tight text-gray-500" title={metric.label}>
                        {metric.label}
                      </span>
                      <span className="text-[11px] font-bold tabular-nums text-gray-900">{metric.value}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-snug text-gray-400">
                  Manually entered per shipment (T/C vessels). Average across shipments in scope.
                </p>
              </div>
            </div>
          </section>

          <section className="mb-6">
            <h4 className="mb-3 text-sm font-semibold text-gray-800">Next Shipment</h4>
            <VesselModalOpenTable
              rows={nextShipmentRows}
              emptyMessage="No planned shipments for this vessel"
            />
          </section>

          <section className="mb-6">
            <h4 className="mb-3 text-sm font-semibold text-gray-800">On Going Shipment</h4>
            <VesselModalOpenTable
              rows={onGoingRows}
              emptyMessage="No ongoing shipments for this vessel"
            />
          </section>

          <section>
            <h4 className="mb-3 text-sm font-semibold text-gray-800">History (Close)</h4>
            <VesselModalHistoryTable
              rows={historyRows}
              emptyMessage="No completed or cancelled shipments for this vessel"
            />
            <p className="mt-2 text-xs text-gray-500">
              Next Shipment = Planned only; On Going = In Progress through Unloading; History =
              Completed or Cancelled. Rows are grouped by STO. Scope respects toolbar filters, not
              the summary card selection.
            </p>
          </section>
        </div>

        <div className="sticky bottom-0 z-10 flex shrink-0 justify-end border-t border-gray-200 bg-white px-6 py-3">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
