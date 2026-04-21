'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import api from '@/lib/api'
import { formatDateDMY } from '@/lib/dateFormat'

type TruckingOperation = {
  id: string
  operation_id: string
  contract_number: string
  sto_number?: string
  location: string
  loading_location?: string
  unloading_location?: string
  trucking_owner: string
  cargo_readiness_date: string
  trucking_start_date: string
  trucking_completion_date: string
  quantity_sent: number
  quantity_delivered: number
  status: string
  contract_ext_no?: string
}

type ShipmentRow = {
  id: string
  shipment_id: string
  operation_id?: string
  sto_number: string
  vessel_name: string
  vessel_code: string
  voyage_no: string
  vessel_owner: string
  port_of_loading: string
  port_of_discharge: string
  quantity_shipped: number
  status: string
  eta_arrival?: string
  eta_berthed?: string
  eta_loading_start?: string
  eta_loading_complete?: string
  eta_sailed?: string
  eta_discharge_arrival?: string
  eta_discharge_berthed?: string
  eta_discharge_start?: string
  eta_discharge_complete?: string
  contract_numbers?: string
}

function fmtDate(s?: string | null) {
  if (!s) return '-'
  return formatDateDMY(s)
}

function fmtNum(n: unknown) {
  if (n === null || n === undefined || n === '') return '-'
  const x = typeof n === 'string' ? parseFloat(n) : Number(n)
  if (!Number.isFinite(x)) return '-'
  return x.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function ContractTruckingDetailModal({
  open,
  contractId,
  onClose,
}: {
  open: boolean
  contractId: string | null
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [ops, setOps] = useState<TruckingOperation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !contractId) return
    let cancelled = false
    setLoading(true)
    void api
      .get('/trucking', { params: { contract: contractId, limit: 100, page: 1 } })
      .then((res) => {
        if (cancelled) return
        const items: TruckingOperation[] = res.data?.data?.truckingOperations ?? []
        setOps(items)
        setSelectedId(items[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setOps([])
          setSelectedId(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, contractId])

  const selected = useMemo(() => ops.find((o) => o.id === selectedId) ?? null, [ops, selectedId])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-lg font-semibold">Trucking operation</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {loading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : ops.length === 0 ? (
            <div className="text-sm text-gray-500">No trucking operations found for this contract.</div>
          ) : (
            <>
              {ops.length > 1 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Operation</label>
                  <select
                    className="w-full border rounded-md px-2 py-2 text-sm"
                    value={selectedId ?? ''}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    {ops.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.operation_id || o.id} — {o.trucking_owner || '—'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {selected && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <Field label="Operation ID" value={selected.operation_id} />
                  <Field label="Status" value={selected.status} />
                  <Field label="Contract" value={selected.contract_number} />
                  <Field label="Contract Ext No" value={selected.contract_ext_no} />
                  <Field label="STO" value={selected.sto_number} />
                  <Field label="Trucking owner" value={selected.trucking_owner} />
                  <Field label="Location" value={selected.location} />
                  <Field label="Loading location" value={selected.loading_location} />
                  <Field label="Unloading location" value={selected.unloading_location} />
                  <Field label="Cargo readiness" value={fmtDate(selected.cargo_readiness_date)} />
                  <Field label="Trucking start" value={fmtDate(selected.trucking_start_date)} />
                  <Field label="Trucking completion" value={fmtDate(selected.trucking_completion_date)} />
                  <Field label="Quantity sent (Kg)" value={fmtNum(selected.quantity_sent)} />
                  <Field label="Quantity delivered (Kg)" value={fmtNum(selected.quantity_delivered)} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="p-2 bg-gray-50 rounded-md">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium mt-0.5 break-words">{value === undefined || value === null || value === '' ? '-' : String(value)}</div>
    </div>
  )
}

export function ContractShipmentDetailModal({
  open,
  contractId,
  onClose,
}: {
  open: boolean
  contractId: string | null
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<ShipmentRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !contractId) return
    let cancelled = false
    setLoading(true)
    void api
      .get('/shipments', { params: { contract: contractId, limit: 100, page: 1, compact: 'true' } })
      .then((res) => {
        if (cancelled) return
        const items: ShipmentRow[] = res.data?.data?.shipments ?? []
        setRows(items)
        setSelectedId(items[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          setRows([])
          setSelectedId(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, contractId])

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-lg font-semibold">Shipment</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {loading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-gray-500">No shipments found for this contract.</div>
          ) : (
            <>
              {rows.length > 1 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Shipment</label>
                  <select
                    className="w-full border rounded-md px-2 py-2 text-sm"
                    value={selectedId ?? ''}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    {rows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {(r.operation_id || r.shipment_id || r.id).toString().slice(0, 80)} — {r.vessel_name || '—'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {selected && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <Field label="Operation ID" value={selected.operation_id} />
                  <Field label="Shipment ID" value={selected.shipment_id} />
                  <Field label="STO" value={selected.sto_number} />
                  <Field label="Status" value={selected.status} />
                  <Field label="Contracts" value={selected.contract_numbers} />
                  <Field label="Vessel" value={selected.vessel_name} />
                  <Field label="Vessel code" value={selected.vessel_code} />
                  <Field label="Voyage" value={selected.voyage_no} />
                  <Field label="Vessel owner" value={selected.vessel_owner} />
                  <Field label="Port of loading" value={selected.port_of_loading} />
                  <Field label="Port of discharge" value={selected.port_of_discharge} />
                  <Field label="Quantity shipped" value={fmtNum(selected.quantity_shipped)} />
                  <Field label="ETA arrival (loading)" value={fmtDate(selected.eta_arrival)} />
                  <Field label="ETA berthed (loading)" value={fmtDate(selected.eta_berthed)} />
                  <Field label="ETA loading start" value={fmtDate(selected.eta_loading_start)} />
                  <Field label="ETA loading complete" value={fmtDate(selected.eta_loading_complete)} />
                  <Field label="ETA sailed" value={fmtDate(selected.eta_sailed)} />
                  <Field label="ETA discharge arrival" value={fmtDate(selected.eta_discharge_arrival)} />
                  <Field label="ETA discharge berthed" value={fmtDate(selected.eta_discharge_berthed)} />
                  <Field label="ETA discharge start" value={fmtDate(selected.eta_discharge_start)} />
                  <Field label="ETA discharge complete" value={fmtDate(selected.eta_discharge_complete)} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
