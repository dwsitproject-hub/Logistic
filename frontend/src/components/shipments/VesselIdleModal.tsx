'use client'

import { useMemo } from 'react'
import { Loader2, Ship, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatVesselCodeDisplay } from '@/lib/formatVesselCodeDisplay'

export interface VesselIdleListRow {
  vessel_code: string
  vessel_name: string
  /** Vessel owner */
  company: string | null
  /** Owner group */
  company_group: string | null
  /** Master vessel terms (V/C | T/C) */
  terms: string | null
  capacity_mt: number | null
  most_loading_port: string | null
  most_discharge_port: string | null
}

export interface VesselWillFreeListRow extends VesselIdleListRow {
  etc_at_discharge: string
}

const PRIORITY_COMPANY_GROUP = 'LMI GROUP'

type VesselIdleModalProps = {
  open: boolean
  loading: boolean
  vessels: VesselIdleListRow[]
  willFree: VesselWillFreeListRow[]
  onClose: () => void
  onVesselNameClick: (vesselName: string) => void
  onAddShipment?: (row: VesselIdleListRow) => void
  canAddShipment?: boolean
}

function displayText(value: string | null | undefined): string {
  const text = String(value ?? '').trim()
  if (!text) return '-'
  return text.toUpperCase()
}

function normalizeCompanyGroupKey(companyGroup: string | null | undefined): string {
  return String(companyGroup ?? '').trim().toUpperCase()
}

export function compareVesselIdleRows(a: VesselIdleListRow, b: VesselIdleListRow): number {
  const groupA = normalizeCompanyGroupKey(a.company_group)
  const groupB = normalizeCompanyGroupKey(b.company_group)
  const aIsPriority = groupA === PRIORITY_COMPANY_GROUP
  const bIsPriority = groupB === PRIORITY_COMPANY_GROUP
  if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1

  const groupCmp = groupA.localeCompare(groupB)
  if (groupCmp !== 0) return groupCmp

  return String(a.vessel_name ?? '')
    .trim()
    .toUpperCase()
    .localeCompare(String(b.vessel_name ?? '').trim().toUpperCase())
}

export function compareVesselWillFreeRows(a: VesselWillFreeListRow, b: VesselWillFreeListRow): number {
  const etcCmp = String(a.etc_at_discharge ?? '').localeCompare(String(b.etc_at_discharge ?? ''))
  if (etcCmp !== 0) return etcCmp
  return compareVesselIdleRows(a, b)
}

function formatCapacityMt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-'
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatShortDate(iso: string | null | undefined): string {
  const text = String(iso ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '-'
  const [yyyy, mm, dd] = text.split('-')
  return `${dd}/${mm}/${yyyy}`
}

function daysUntil(iso: string, referenceToday = new Date()): number | null {
  const text = String(iso ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const target = new Date(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)))
  const today = new Date(referenceToday.getFullYear(), referenceToday.getMonth(), referenceToday.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function VesselTable({
  rows,
  showEtc,
  onVesselNameClick,
  onAddShipment,
  canAddShipment,
}: {
  rows: Array<VesselIdleListRow | VesselWillFreeListRow>
  showEtc?: boolean
  onVesselNameClick: (vesselName: string) => void
  onAddShipment?: (row: VesselIdleListRow) => void
  canAddShipment?: boolean
}) {
  const addDisabledReason = canAddShipment
    ? null
    : 'Create or Edit permission on Shipments is required'

  return (
    <div className="max-h-[min(40vh,320px)] overflow-auto rounded-lg border border-gray-200">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="sticky top-0 z-[1] bg-gray-100">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Vessel Code</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Vessel Name</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Company</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Company Group</th>
            {showEtc ? (
              <>
                <th className="px-3 py-2 text-left font-medium text-gray-600">ETC at Discharge</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Days</th>
              </>
            ) : null}
            <th className="px-3 py-2 text-right font-medium text-gray-600">Capacity</th>
            {onAddShipment ? (
              <th className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => {
            const vesselNameDisplay = displayText(row.vessel_name)
            const vesselNameRaw = String(row.vessel_name ?? '').trim()
            const rowKey = `${row.vessel_code}-${row.vessel_name}-${showEtc ? (row as VesselWillFreeListRow).etc_at_discharge : 'idle'}`
            const etcIso = showEtc ? (row as VesselWillFreeListRow).etc_at_discharge : ''
            const days = showEtc ? daysUntil(etcIso) : null
            return (
              <tr key={rowKey} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 uppercase">{formatVesselCodeDisplay(row.vessel_code)}</td>
                <td className="whitespace-nowrap px-3 py-2 uppercase">
                  {vesselNameDisplay === '-' ? (
                    <span className="text-gray-400">-</span>
                  ) : (
                    <button
                      type="button"
                      className="text-left font-medium text-blue-700 hover:text-blue-900 hover:underline"
                      onClick={() => onVesselNameClick(vesselNameRaw)}
                    >
                      {vesselNameDisplay}
                    </button>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 uppercase">{displayText(row.company)}</td>
                <td className="whitespace-nowrap px-3 py-2 uppercase">{displayText(row.company_group)}</td>
                {showEtc ? (
                  <>
                    <td className="whitespace-nowrap px-3 py-2">{formatShortDate(etcIso)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {days == null ? '-' : days}
                    </td>
                  </>
                ) : null}
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {formatCapacityMt(row.capacity_mt)}
                </td>
                {onAddShipment ? (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={!canAddShipment}
                            onClick={() => onAddShipment(row)}
                            className="bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
                            aria-label="Add shipment"
                          >
                            <Ship className="h-4 w-4" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {canAddShipment
                          ? 'Add shipment with this vessel'
                          : addDisabledReason}
                      </TooltipContent>
                    </Tooltip>
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function VesselIdleModal({
  open,
  loading,
  vessels,
  willFree,
  onClose,
  onVesselNameClick,
  onAddShipment,
  canAddShipment = true,
}: VesselIdleModalProps) {
  const sortedIdle = useMemo(() => [...vessels].sort(compareVesselIdleRows), [vessels])
  const sortedWillFree = useMemo(() => [...willFree].sort(compareVesselWillFreeRows), [willFree])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Ship className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Vessel Idle</h2>
              <p className="text-sm text-gray-500">
                Idle vessels and T/C vessels expected to free within 7 days (ETC at Discharge Port)
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              Loading vessel availability…
            </div>
          ) : (
            <>
              <section>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">Idle</h3>
                  <p className="text-xs text-gray-500">
                    No SAP STO, planned ETA, or on-going shipment
                  </p>
                </div>
                {sortedIdle.length === 0 ? (
                  <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-10 text-sm text-gray-500">
                    No idle vessels found in master data.
                  </div>
                ) : (
                  <VesselTable
                    rows={sortedIdle}
                    onVesselNameClick={onVesselNameClick}
                    onAddShipment={onAddShipment}
                    canAddShipment={canAddShipment}
                  />
                )}
              </section>

              <section>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">Will Free</h3>
                  <p className="text-xs text-gray-500">
                    On-going shipment with ETC at Discharge Port within 7 days
                  </p>
                </div>
                {sortedWillFree.length === 0 ? (
                  <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-10 text-sm text-gray-500">
                    No vessels expected to free within the next 7 days.
                  </div>
                ) : (
                  <VesselTable
                    rows={sortedWillFree}
                    showEtc
                    onVesselNameClick={onVesselNameClick}
                    onAddShipment={onAddShipment}
                    canAddShipment={canAddShipment}
                  />
                )}
              </section>
            </>
          )}
        </div>

        <div className="border-t border-gray-200 px-6 py-3 text-xs text-gray-500">
          {loading
            ? '…'
            : `${sortedIdle.length.toLocaleString('en-US')} idle · ${sortedWillFree.length.toLocaleString('en-US')} will free within 7 days`}
        </div>
      </div>
    </div>
  )
}
