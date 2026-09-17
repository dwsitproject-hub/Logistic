'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDateDMY } from '@/lib/dateFormat'
import { formatOilLossMtFromKg, formatOilLossPct } from '@/lib/oilLossFormat'
import { oilLossTransporterGroupKey } from '@/lib/oilLossByTransporterColumns'
import { oilLossSupplierGroupKey } from '@/lib/oilLossBySupplierColumns'
import { sumR4OilLossPctByContract } from '@/lib/oilLossSummary'
import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'
import { cn } from '@/lib/utils'
import { OperationalStackedCommaCell } from '@/lib/operationalTableLayout'
import {
  matchesOilLossTruckSegment,
  matchesOilLossVesselSegment,
} from '@/lib/oilLossEligibility'
import { Building2, Ship, Truck, X, type LucideIcon } from 'lucide-react'

export type OilLossGroupKind = 'transporter' | 'supplier'

export type OilLossGroupHistoryModalSelection = {
  kind: OilLossGroupKind
  entityName: string
  entityKey: string
  loadingLocations: string | null
  unloadingLocations: string | null
}

/** @deprecated Use OilLossGroupHistoryModalSelection */
export type TransporterHistoryModalSelection = {
  transporterName: string
  transporterKey: string
  loadingLocations: string | null
  unloadingLocations: string | null
  oilLossMtKg: number | null
  oilLossPct: number | null
}

export type OilLossGroupHistoryContractRow = {
  id: string
  transporter?: string | null
  supplier?: string | null
  contract_number?: string | null
  contract_date?: string | null
  contract_ext_no?: string | null
  po_number?: string | null
  sto_number?: string | null
  quantity_delivery?: number | null
  quantity_received?: number | null
  gain_loss_amount?: number | null
  gain_loss_percentage?: number | null
  status?: string | null
  transport_mode?: string | null
  sto_type?: string | null
}

/** @deprecated Use OilLossGroupHistoryContractRow */
export type TransporterHistoryContractRow = OilLossGroupHistoryContractRow

type OilLossGroupHistoryModalProps = {
  open: boolean
  onClose: () => void
  selection: OilLossGroupHistoryModalSelection | null
  sourceRows: OilLossGroupHistoryContractRow[]
}

const CONTRACT_COLUMNS: Array<{
  key: keyof OilLossGroupHistoryContractRow
  label: string
  align?: 'left' | 'right'
}> = [
  { key: 'contract_date', label: 'Contract Date' },
  { key: 'contract_ext_no', label: 'Contract Ext No' },
  { key: 'po_number', label: 'PO' },
  { key: 'sto_number', label: 'STO' },
  { key: 'quantity_delivery', label: 'Qty Delivery', align: 'right' },
  { key: 'quantity_received', label: 'Qty Received', align: 'right' },
  { key: 'gain_loss_amount', label: 'Oil Loss', align: 'right' },
  { key: 'gain_loss_percentage', label: 'Oil Loss %', align: 'right' },
  { key: 'status', label: 'Status' },
]

function formatQtyMtFromKg(kg: number | null | undefined): string {
  const n = kg === null || kg === undefined ? 0 : Number(kg)
  const mt = Number.isFinite(n) ? n / 1000 : 0
  return mt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
}

function getStatusColor(status: string) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'close' || normalized === 'closed' || normalized === 'completed') {
    return 'bg-green-100 text-green-800'
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'bg-red-100 text-red-800'
  }
  if (normalized === 'open' || normalized === 'in progress' || normalized === 'in_progress') {
    return 'bg-yellow-100 text-yellow-800'
  }
  return 'bg-gray-100 text-gray-800'
}

function sortByContractDateDesc(rows: OilLossGroupHistoryContractRow[]): OilLossGroupHistoryContractRow[] {
  return [...rows].sort((a, b) => {
    const aDate = String(a.contract_date ?? '').slice(0, 10)
    const bDate = String(b.contract_date ?? '').slice(0, 10)
    return bDate.localeCompare(aDate)
  })
}

function splitLocationList(value: string | null | undefined): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  const parts = new Set<string>()
  for (const piece of raw.split(',')) {
    const t = piece.trim()
    if (t) parts.add(t)
  }
  return [...parts]
}

function matchesGroupKey(
  row: OilLossGroupHistoryContractRow,
  kind: OilLossGroupKind,
  entityKey: string,
): boolean {
  if (kind === 'transporter') {
    return oilLossTransporterGroupKey(row) === entityKey
  }
  return oilLossSupplierGroupKey(row) === entityKey
}

function renderContractCell(row: OilLossGroupHistoryContractRow, key: keyof OilLossGroupHistoryContractRow) {
  if (key === 'contract_date') {
    const d = String(row.contract_date ?? '').slice(0, 10)
    return <span>{d ? formatDateDMY(d) : '—'}</span>
  }
  if (key === 'contract_ext_no' || key === 'po_number' || key === 'sto_number') {
    const val = row[key]
    return <OperationalStackedCommaCell value={val} title={String(val ?? '')} />
  }
  if (key === 'quantity_delivery' || key === 'quantity_received') {
    return <span className="tabular-nums">{formatQtyMtFromKg(row[key])}</span>
  }
  if (key === 'gain_loss_amount') {
    const kg = row.gain_loss_amount
    const tone =
      kg != null && kg < 0 ? 'text-red-600' : kg != null && kg > 0 ? 'text-green-600' : 'text-gray-900'
    return <span className={cn('tabular-nums', tone)}>{formatOilLossMtFromKg(kg)}</span>
  }
  if (key === 'gain_loss_percentage') {
    const pct = row.gain_loss_percentage
    const tone =
      pct != null && pct < 0 ? 'text-red-600' : pct != null && pct > 0 ? 'text-green-600' : 'text-gray-900'
    return <span className={cn('tabular-nums', tone)}>{formatOilLossPct(pct)}</span>
  }
  if (key === 'status') {
    const status = String(row.status ?? '').trim()
    if (!status) return <span className="text-gray-400">—</span>
    return <Badge className={getStatusColor(status)}>{status}</Badge>
  }
  return <span>—</span>
}

function GroupContractTable({
  rows,
  emptyMessage,
}: {
  rows: OilLossGroupHistoryContractRow[]
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
              {CONTRACT_COLUMNS.map((col) => (
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
                {CONTRACT_COLUMNS.map((col) => (
                  <td
                    key={`${row.id}-${String(col.key)}`}
                    className={cn(
                      'px-3 py-2',
                      col.align === 'right' ? 'text-right' : 'text-left',
                      col.key === 'contract_ext_no' || col.key === 'po_number' || col.key === 'sto_number'
                        ? 'align-top'
                        : 'whitespace-nowrap',
                    )}
                  >
                    {renderContractCell(row, col.key)}
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

function LocationList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      {items.length === 0 ? (
        <div className="text-sm text-gray-400">—</div>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item} className="text-sm font-semibold text-gray-900">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const GROUP_META: Record<
  OilLossGroupKind,
  {
    summaryTitle: string
    emptyContracts: string
  }
> = {
  transporter: {
    summaryTitle: 'Transporter summary & performance',
    emptyContracts: 'No contracts for this transporter',
  },
  supplier: {
    summaryTitle: 'Supplier summary & performance',
    emptyContracts: 'No contracts for this supplier',
  },
}

function resolveTransporterEntityIcon(rows: OilLossGroupHistoryContractRow[]): LucideIcon {
  if (rows.length === 0) return Truck
  let vesselCount = 0
  let truckCount = 0
  for (const row of rows) {
    if (matchesOilLossVesselSegment(row)) vesselCount += 1
    if (matchesOilLossTruckSegment(row)) truckCount += 1
  }
  if (vesselCount > 0 && truckCount === 0) return Ship
  if (truckCount > 0 && vesselCount === 0) return Truck
  return vesselCount >= truckCount ? Ship : Truck
}

function resolveEntityIcon(
  kind: OilLossGroupKind,
  scopedRows: OilLossGroupHistoryContractRow[],
): LucideIcon {
  if (kind === 'supplier') return Building2
  return resolveTransporterEntityIcon(scopedRows)
}

export default function TransporterHistoryModal({
  open,
  onClose,
  selection,
  sourceRows,
}: OilLossGroupHistoryModalProps) {
  const scopedRows = useMemo(() => {
    if (!selection) return []
    return sourceRows.filter((row) => matchesGroupKey(row, selection.kind, selection.entityKey))
  }, [sourceRows, selection])

  const contractRows = useMemo(() => sortByContractDateDesc(scopedRows), [scopedRows])

  const summaryMetrics = useMemo(() => {
    const oilLossRows = scopedRows.map(
      (row) =>
        ({
          id: row.id,
          contract_number: row.contract_number,
          contract_ext_no: row.contract_ext_no,
          quantity_sent: row.quantity_delivery,
          quantity_received: row.quantity_received,
        }) satisfies Pick<
          OilLossSourceRow,
          'id' | 'contract_number' | 'contract_ext_no' | 'quantity_sent' | 'quantity_received'
        >,
    )
    const mtKg = scopedRows.reduce((sum, row) => sum + Number(row.gain_loss_amount ?? 0), 0)
    const pct = sumR4OilLossPctByContract(oilLossRows as OilLossSourceRow[])
    return { mtKg, pct }
  }, [scopedRows])

  if (!open || !selection) return null

  const meta = GROUP_META[selection.kind]
  const EntityIcon = resolveEntityIcon(selection.kind, scopedRows)
  const loadingItems = splitLocationList(selection.loadingLocations)
  const unloadingItems = splitLocationList(selection.unloadingLocations)
  const totalRecords = contractRows.length
  const displayMtKg = summaryMetrics.mtKg
  const displayPct = summaryMetrics.pct
  const lossTone =
    displayMtKg != null && displayMtKg < 0
      ? 'text-red-700'
      : displayMtKg != null && displayMtKg > 0
        ? 'text-green-700'
        : 'text-gray-900'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
        <div className="sticky top-0 z-10 shrink-0 rounded-t-lg border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                <EntityIcon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold text-gray-900">{selection.entityName}</h3>
                <p className="text-xs text-gray-500">
                  {totalRecords.toLocaleString('en-US')} contract
                  {totalRecords === 1 ? '' : 's'} in scope
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
              <EntityIcon className="h-4 w-4 text-blue-600" />
              {meta.summaryTitle}
            </div>
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-gray-50/40 p-4 lg:grid-cols-2">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LocationList label="Loading Location" items={loadingItems} />
                <LocationList label="Unloading Location" items={unloadingItems} />
              </div>
              <div className="min-w-0 border-t border-gray-200 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Oil loss performance
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium text-gray-500">Oil Loss</div>
                    <div className={cn('mt-0.5 text-sm font-bold tabular-nums', lossTone)}>
                      {formatOilLossMtFromKg(displayMtKg)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500">Oil Loss (%)</div>
                    <div className={cn('mt-0.5 text-sm font-bold tabular-nums', lossTone)}>
                      {formatOilLossPct(displayPct)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h4 className="mb-3 text-sm font-semibold text-gray-800">Contract Details</h4>
            <GroupContractTable rows={contractRows} emptyMessage={meta.emptyContracts} />
            <p className="mt-2 text-xs text-gray-500">
              Scope respects toolbar filters on the Oil Loss page.
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
