'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatAvgDays, signedCycleDaysClass } from '@/lib/cycleDaysDisplay'
import { partitionVesselHistoryByStatus } from '@/lib/vesselHistoryPartition'
import {
  resolveShippingPerfDischargePort,
  resolveShippingPerfLoadingPort,
  type ShippingPerformancePortSource,
} from '@/lib/shippingPerformancePorts'
import { cn } from '@/lib/utils'
import { Anchor, Loader2, Ship, X } from 'lucide-react'

export type VesselHistoryModalSelection = {
  vesselName: string
  vesselKey: string
}

export type VesselHistoryShipmentRow = ShippingPerformancePortSource & {
  id: string
  contract_date?: string | null
  contract_ext_no?: string | null
  po_number?: string | null
  product?: string | null
  incoterm?: string | null
  supplier?: string | null
  loading_port?: string | null
  discharge_port?: string | null
  delivered_qty?: number | null
  received_qty?: number | null
  status?: string | null
  vessel_name?: string | null
  loading_ata_arrival?: string | null
  loading_ata_berthed?: string | null
  loading_ata_completed?: string | null
  discharge_ata_arrival?: string | null
  discharge_ata_berthed?: string | null
  discharge_ata_completed?: string | null
  ata_loading_delta_eta_etr_days?: number | null
  ata_loading_delta_eta_etb_days?: number | null
  ata_loading_delta_etb_etc_days?: number | null
  ata_discharge_delta_eta_etb_days?: number | null
  ata_discharge_delta_etb_etc_days?: number | null
  ata_total_delta_days?: number | null
}

type MasterVesselProfile = {
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

const HISTORY_COLUMNS: Array<{
  key: keyof VesselHistoryShipmentRow
  label: string
  align?: 'left' | 'right'
}> = [
  { key: 'contract_date', label: 'Contract Date' },
  { key: 'contract_ext_no', label: 'Contract Ext No' },
  { key: 'po_number', label: 'PO' },
  { key: 'product', label: 'Product' },
  { key: 'incoterm', label: 'Incoterm' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'loading_port', label: 'Loading Port' },
  { key: 'discharge_port', label: 'Discharge Port' },
  { key: 'delivered_qty', label: 'Qty Delivery', align: 'right' },
  { key: 'received_qty', label: 'Qty Receive', align: 'right' },
  { key: 'status', label: 'Status' },
]

function normalizeVesselKey(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  return trimmed || 'Unknown'
}

function displayLabel(value: unknown, fallback = '-'): string {
  const text = String(value ?? '').trim()
  if (!text || text === 'Blank') return fallback
  return text
}

function sortByContractDateDesc(rows: VesselHistoryShipmentRow[]): VesselHistoryShipmentRow[] {
  return [...rows].sort((a, b) => {
    const aDate = String(a.contract_date ?? '').slice(0, 10)
    const bDate = String(b.contract_date ?? '').slice(0, 10)
    return bDate.localeCompare(aDate)
  })
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

function formatContractDate(value: string | null | undefined): string {
  if (!value) return '-'
  const iso = String(value).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const [, y, m, d] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? []
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

function formatQtyMt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-'
  const mt = Number(value) / 1000
  return `${mt.toLocaleString('en-US', { maximumFractionDigits: 2 })} MT`
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'PLANNED':
      return 'bg-blue-100 text-blue-800'
    case 'IN_PROGRESS':
      return 'bg-yellow-100 text-yellow-800'
    case 'LOADING':
      return 'bg-orange-100 text-orange-800'
    case 'IN_TRANSIT':
      return 'bg-purple-100 text-purple-800'
    case 'ARRIVED':
      return 'bg-indigo-100 text-indigo-800'
    case 'UNLOADING':
      return 'bg-cyan-100 text-cyan-800'
    case 'COMPLETED':
      return 'bg-green-100 text-green-800'
    case 'CANCELLED':
    case 'CANCELED':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

function renderHistoryCell(row: VesselHistoryShipmentRow, key: keyof VesselHistoryShipmentRow) {
  if (key === 'contract_date') {
    return <span>{formatContractDate(row.contract_date)}</span>
  }
  if (key === 'delivered_qty' || key === 'received_qty') {
    return <span>{formatQtyMt(row[key])}</span>
  }
  if (key === 'status') {
    const status = String(row.status ?? '').trim()
    if (!status) return <span className="text-gray-400">-</span>
    return <Badge className={getStatusColor(status)}>{status}</Badge>
  }
  if (key === 'loading_port') {
    return <span>{displayLabel(resolveShippingPerfLoadingPort(row))}</span>
  }
  if (key === 'discharge_port') {
    return <span>{displayLabel(resolveShippingPerfDischargePort(row))}</span>
  }
  return <span>{displayLabel(row[key])}</span>
}

function VesselHistoryShipmentTable({
  rows,
  emptyMessage,
}: {
  rows: VesselHistoryShipmentRow[]
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
        <table className="w-full min-w-[960px] text-sm">
          <thead className="sticky top-0 z-[1] bg-gray-100">
            <tr>
              {HISTORY_COLUMNS.map((col) => (
                <th
                  key={String(col.key)}
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
                {HISTORY_COLUMNS.map((col) => (
                  <td
                    key={`${row.id}-${String(col.key)}`}
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

  const { onGoingShipments, historyShipments } = useMemo(() => {
    const partitioned = partitionVesselHistoryByStatus(vesselRows)
    return {
      onGoingShipments: sortByContractDateDesc(partitioned.onGoingShipments),
      historyShipments: sortByContractDateDesc(partitioned.historyShipments),
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
      const normalized = vesselName.trim().toLowerCase()
      const exact =
        items.find((v) => String(v.vessel_name ?? '').trim().toLowerCase() === normalized) ??
        items[0]
      if (exact) {
        setProfile({
          vessel_owner_group: exact.vessel_owner_group ?? null,
          vessel_owner: exact.vessel_owner ?? null,
          vessel_capacity_mt: exact.vessel_capacity_mt ?? null,
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

  const profileFields: Array<{ label: string; value: string }> = [
    { label: 'Owner Group', value: displayLabel(profile?.vessel_owner_group) },
    { label: 'Owner', value: displayLabel(profile?.vessel_owner) },
    {
      label: 'Capacity (MT)',
      value:
        profile?.vessel_capacity_mt != null && Number.isFinite(profile.vessel_capacity_mt)
          ? Number(profile.vessel_capacity_mt).toLocaleString('en-US', { maximumFractionDigits: 2 })
          : '-',
    },
    { label: 'Hull Type', value: displayLabel(profile?.hull_type) },
    { label: 'Lambung Type', value: displayLabel(profile?.lambung_type) },
  ]

  const totalRecords = onGoingShipments.length + historyShipments.length

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
                <h3 className="truncate text-lg font-semibold text-gray-900">{selection.vesselName}</h3>
                <p className="text-xs text-gray-500">
                  {onGoingShipments.length.toLocaleString('en-US')} on going ·{' '}
                  {historyShipments.length.toLocaleString('en-US')} history ·{' '}
                  {totalRecords.toLocaleString('en-US')} total in scope
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
                <VesselAtaAveragesGrid historyShipments={historyShipments} />
              </div>
            </div>
          </section>

          <section className="mb-6">
            <h4 className="mb-3 text-sm font-semibold text-gray-800">Shipment On Going</h4>
            <VesselHistoryShipmentTable
              rows={onGoingShipments}
              emptyMessage="No ongoing shipments for this vessel"
            />
          </section>

          <section>
            <h4 className="mb-3 text-sm font-semibold text-gray-800">History (Close)</h4>
            <VesselHistoryShipmentTable
              rows={historyShipments}
              emptyMessage="No completed or cancelled shipments for this vessel"
            />
            <p className="mt-2 text-xs text-gray-500">
              On Going = Planned through Unloading; History = Completed or Cancelled only. Scope
              respects toolbar filters, not the summary card selection.
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
