'use client'

import { Loader2, Ship, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface VesselIdleListRow {
  vessel_code: string
  vessel_name: string
  company: string | null
  capacity_mt: number | null
  most_loading_port: string | null
  most_discharge_port: string | null
}

type VesselIdleModalProps = {
  open: boolean
  loading: boolean
  vessels: VesselIdleListRow[]
  onClose: () => void
  onVesselNameClick: (vesselName: string) => void
}

function displayText(value: string | null | undefined): string {
  const text = String(value ?? '').trim()
  return text || '-'
}

function formatCapacityMt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-'
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function VesselIdleModal({
  open,
  loading,
  vessels,
  onClose,
  onVesselNameClick,
}: VesselIdleModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Ship className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Vessel Idle</h2>
              <p className="text-sm text-gray-500">
                Vessels without SAP STO, planned ETA, or on-going shipment
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              Loading vessel idle list…
            </div>
          ) : vessels.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-16 text-sm text-gray-500">
              No idle vessels found in master data.
            </div>
          ) : (
            <div className="max-h-[calc(85vh-8rem)] overflow-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="sticky top-0 z-[1] bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Vessel Code</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Vessel Name</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Company</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Capacity</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Most Loading Port</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Most Discharge Port</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vessels.map((row) => {
                    const vesselName = displayText(row.vessel_name)
                    const rowKey = `${row.vessel_code}-${row.vessel_name}`
                    return (
                      <tr key={rowKey} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-3 py-2">{displayText(row.vessel_code)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {vesselName === '-' ? (
                            <span className="text-gray-400">-</span>
                          ) : (
                            <button
                              type="button"
                              className="text-left font-medium text-blue-700 hover:text-blue-900 hover:underline"
                              onClick={() => onVesselNameClick(vesselName)}
                            >
                              {vesselName}
                            </button>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{displayText(row.company)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {formatCapacityMt(row.capacity_mt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{displayText(row.most_loading_port)}</td>
                        <td className="whitespace-nowrap px-3 py-2">{displayText(row.most_discharge_port)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 px-6 py-3 text-xs text-gray-500">
          {loading ? '…' : `${vessels.length.toLocaleString('en-US')} idle vessel(s)`}
        </div>
      </div>
    </div>
  )
}
