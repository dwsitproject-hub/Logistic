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

function avgAtaDelta(
  rows: VesselHistoryShipmentRow[],
  key: keyof VesselHistoryShipmentRow,
): number | null {
  const vals = rows
    .map((r) => r[key])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (vals.length === 0) return null
  const avg = vals.reduce((sum, v) => sum + v, 0) / vals.length
  return Math.round(avg * 10) / 10
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

  const vesselRows = useMemo(() => {
    if (!selection) return []
    return sourceRows.filter(
      (row) => normalizeVesselKey(row.vessel_name) === selection.vesselKey,
    )
  }, [sourceRows, selection])

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

  if (!open || !selection) return null

  const vesselTitle = formatVesselModalTitle(profile?.vessel_code, selection.vesselName)

  const profileFields: Array<{ label: string; value: string }> = [
    { label: 'Owner Group', value: displayLabel(profile?.vessel_owner_group) },
    { label: 'Owner', value: displayLabel(profile?.vessel_owner) },
    {
      label: 'Capacity (MT)',
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
