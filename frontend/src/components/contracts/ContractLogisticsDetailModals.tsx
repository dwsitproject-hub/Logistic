'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { X, Pencil } from 'lucide-react'
import api from '@/lib/api'
import { formatDateDMY } from '@/lib/dateFormat'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'

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

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="p-2 bg-gray-50 rounded-md">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium mt-0.5 break-words">{value === undefined || value === null || value === '' ? '-' : String(value)}</div>
    </div>
  )
}

function DateField({
  label,
  valueIso,
  onChange,
}: {
  label: string
  valueIso: string
  onChange: (iso: string) => void
}) {
  return (
    <div className="p-2 bg-blue-50 border border-blue-200 rounded-md">
      <div className="text-xs text-blue-600 mb-1">{label}</div>
      <DateInputDdMmYyyy valueIso={valueIso} onChangeIso={onChange} className="h-8 text-sm bg-white" />
    </div>
  )
}

// ─── Trucking Modal ────────────────────────────────────────────────────────────

type TruckEditDates = {
  cargo_readiness_date: string
  trucking_start_date: string
  trucking_completion_date: string
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
  const [isEditing, setIsEditing] = useState(false)
  const [editDates, setEditDates] = useState<TruckEditDates>({ cargo_readiness_date: '', trucking_start_date: '', trucking_completion_date: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !contractId) return
    let cancelled = false
    setLoading(true)
    setIsEditing(false)
    void api
      .get('/trucking', { params: { contract: contractId, limit: 100, page: 1 } })
      .then((res) => {
        if (cancelled) return
        const items: TruckingOperation[] = res.data?.data?.truckingOperations ?? []
        setOps(items)
        setSelectedId(items[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) { setOps([]); setSelectedId(null) }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, contractId])

  const selected = useMemo(() => ops.find((o) => o.id === selectedId) ?? null, [ops, selectedId])

  const startEdit = () => {
    if (!selected) return
    setEditDates({
      cargo_readiness_date: selected.cargo_readiness_date ?? '',
      trucking_start_date: selected.trucking_start_date ?? '',
      trucking_completion_date: selected.trucking_completion_date ?? '',
    })
    setIsEditing(true)
  }

  const cancelEdit = () => setIsEditing(false)

  const saveEdit = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await api.put(`/trucking/${selected.id}`, {
        cargo_readiness_date: editDates.cargo_readiness_date || null,
        trucking_start_date: editDates.trucking_start_date || null,
        trucking_completion_date: editDates.trucking_completion_date || null,
      })
      setOps((prev) => prev.map((o) => o.id === selected.id ? { ...o, ...editDates } : o))
      setIsEditing(false)
    } catch {
      alert('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-lg font-semibold">Trucking operation</h3>
          <div className="flex items-center gap-2">
            {!isEditing && selected && (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="h-4 w-4 mr-1" /> Edit Dates
              </Button>
            )}
            {isEditing && (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>Cancel</Button>
                <Button size="sm" onClick={saveEdit} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
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
                    onChange={(e) => { setSelectedId(e.target.value); setIsEditing(false) }}
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
                <>
                  {/* Read-only info */}
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Contract Information</div>
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
                      <Field label="Quantity sent (Kg)" value={fmtNum(selected.quantity_sent)} />
                      <Field label="Quantity delivered (Kg)" value={fmtNum(selected.quantity_delivered)} />
                    </div>
                  </div>

                  {/* Date fields */}
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      Dates {isEditing && <span className="text-blue-500 normal-case font-normal ml-1">— editing</span>}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      {isEditing ? (
                        <>
                          <DateField label="Cargo readiness" valueIso={editDates.cargo_readiness_date} onChange={(v) => setEditDates((p) => ({ ...p, cargo_readiness_date: v }))} />
                          <DateField label="Trucking start" valueIso={editDates.trucking_start_date} onChange={(v) => setEditDates((p) => ({ ...p, trucking_start_date: v }))} />
                          <DateField label="Trucking completion" valueIso={editDates.trucking_completion_date} onChange={(v) => setEditDates((p) => ({ ...p, trucking_completion_date: v }))} />
                        </>
                      ) : (
                        <>
                          <Field label="Cargo readiness" value={fmtDate(selected.cargo_readiness_date)} />
                          <Field label="Trucking start" value={fmtDate(selected.trucking_start_date)} />
                          <Field label="Trucking completion" value={fmtDate(selected.trucking_completion_date)} />
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Shipment Modal ────────────────────────────────────────────────────────────

type ShipEditDates = {
  eta_arrival: string
  eta_berthed: string
  eta_loading_start: string
  eta_loading_complete: string
  eta_sailed: string
  eta_discharge_arrival: string
  eta_discharge_berthed: string
  eta_discharge_start: string
  eta_discharge_complete: string
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
  const [isEditing, setIsEditing] = useState(false)
  const [editDates, setEditDates] = useState<ShipEditDates>({
    eta_arrival: '', eta_berthed: '', eta_loading_start: '', eta_loading_complete: '',
    eta_sailed: '', eta_discharge_arrival: '', eta_discharge_berthed: '', eta_discharge_start: '', eta_discharge_complete: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !contractId) return
    let cancelled = false
    setLoading(true)
    setIsEditing(false)
    void api
      .get('/shipments', { params: { contract: contractId, limit: 100, page: 1, compact: 'true' } })
      .then((res) => {
        if (cancelled) return
        const items: ShipmentRow[] = res.data?.data?.shipments ?? []
        setRows(items)
        setSelectedId(items[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) { setRows([]); setSelectedId(null) }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, contractId])

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId])

  const startEdit = () => {
    if (!selected) return
    setEditDates({
      eta_arrival: selected.eta_arrival ?? '',
      eta_berthed: selected.eta_berthed ?? '',
      eta_loading_start: selected.eta_loading_start ?? '',
      eta_loading_complete: selected.eta_loading_complete ?? '',
      eta_sailed: selected.eta_sailed ?? '',
      eta_discharge_arrival: selected.eta_discharge_arrival ?? '',
      eta_discharge_berthed: selected.eta_discharge_berthed ?? '',
      eta_discharge_start: selected.eta_discharge_start ?? '',
      eta_discharge_complete: selected.eta_discharge_complete ?? '',
    })
    setIsEditing(true)
  }

  const cancelEdit = () => setIsEditing(false)

  const saveEdit = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await api.put(`/shipments/${selected.id}`, {
        eta_arrival: editDates.eta_arrival || null,
        eta_berthed: editDates.eta_berthed || null,
        eta_loading_start: editDates.eta_loading_start || null,
        eta_loading_complete: editDates.eta_loading_complete || null,
        eta_sailed: editDates.eta_sailed || null,
        eta_discharge_arrival: editDates.eta_discharge_arrival || null,
        eta_discharge_berthed: editDates.eta_discharge_berthed || null,
        eta_discharge_start: editDates.eta_discharge_start || null,
        eta_discharge_complete: editDates.eta_discharge_complete || null,
      })
      setRows((prev) => prev.map((r) => r.id === selected.id ? { ...r, ...editDates } : r))
      setIsEditing(false)
    } catch {
      alert('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-lg font-semibold">Shipment</h3>
          <div className="flex items-center gap-2">
            {!isEditing && selected && (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="h-4 w-4 mr-1" /> Edit Dates
              </Button>
            )}
            {isEditing && (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>Cancel</Button>
                <Button size="sm" onClick={saveEdit} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
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
                    onChange={(e) => { setSelectedId(e.target.value); setIsEditing(false) }}
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
                <>
                  {/* Read-only info */}
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Shipment Information</div>
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
                    </div>
                  </div>

                  {/* ETA date fields */}
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      ETA Dates {isEditing && <span className="text-blue-500 normal-case font-normal ml-1">— editing</span>}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      {isEditing ? (
                        <>
                          <DateField label="ETA arrival (loading)" valueIso={editDates.eta_arrival} onChange={(v) => setEditDates((p) => ({ ...p, eta_arrival: v }))} />
                          <DateField label="ETA berthed (loading)" valueIso={editDates.eta_berthed} onChange={(v) => setEditDates((p) => ({ ...p, eta_berthed: v }))} />
                          <DateField label="ETA loading start" valueIso={editDates.eta_loading_start} onChange={(v) => setEditDates((p) => ({ ...p, eta_loading_start: v }))} />
                          <DateField label="ETA loading complete" valueIso={editDates.eta_loading_complete} onChange={(v) => setEditDates((p) => ({ ...p, eta_loading_complete: v }))} />
                          <DateField label="ETA sailed" valueIso={editDates.eta_sailed} onChange={(v) => setEditDates((p) => ({ ...p, eta_sailed: v }))} />
                          <DateField label="ETA discharge arrival" valueIso={editDates.eta_discharge_arrival} onChange={(v) => setEditDates((p) => ({ ...p, eta_discharge_arrival: v }))} />
                          <DateField label="ETA discharge berthed" valueIso={editDates.eta_discharge_berthed} onChange={(v) => setEditDates((p) => ({ ...p, eta_discharge_berthed: v }))} />
                          <DateField label="ETA discharge start" valueIso={editDates.eta_discharge_start} onChange={(v) => setEditDates((p) => ({ ...p, eta_discharge_start: v }))} />
                          <DateField label="ETA discharge complete" valueIso={editDates.eta_discharge_complete} onChange={(v) => setEditDates((p) => ({ ...p, eta_discharge_complete: v }))} />
                        </>
                      ) : (
                        <>
                          <Field label="ETA arrival (loading)" value={fmtDate(selected.eta_arrival)} />
                          <Field label="ETA berthed (loading)" value={fmtDate(selected.eta_berthed)} />
                          <Field label="ETA loading start" value={fmtDate(selected.eta_loading_start)} />
                          <Field label="ETA loading complete" value={fmtDate(selected.eta_loading_complete)} />
                          <Field label="ETA sailed" value={fmtDate(selected.eta_sailed)} />
                          <Field label="ETA discharge arrival" value={fmtDate(selected.eta_discharge_arrival)} />
                          <Field label="ETA discharge berthed" value={fmtDate(selected.eta_discharge_berthed)} />
                          <Field label="ETA discharge start" value={fmtDate(selected.eta_discharge_start)} />
                          <Field label="ETA discharge complete" value={fmtDate(selected.eta_discharge_complete)} />
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
