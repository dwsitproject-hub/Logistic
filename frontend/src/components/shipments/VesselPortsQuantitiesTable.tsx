'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatQtyMtFromKg } from '@/lib/utils'
import {
  DECIMAL_DOT_HINT,
  blockCommaDecimalKeyDown,
  parseDecimalDotInput,
  sanitizeDecimalDotInput,
} from '@/lib/decimalDotInput'
import {
  VESSEL_MODAL_COMPACT_TD,
  VESSEL_MODAL_COMPACT_TH,
  VESSEL_MODAL_TABLE_FOOTER_CLASS,
} from '@/lib/vesselModalUi'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import type { VesselPortsQuantityEdits, VesselPortsQuantityRow } from '@/lib/vesselPortsQuantityEdits'
import { Check, Edit2, Loader2, X } from 'lucide-react'

export type { VesselPortsQuantityEdits, VesselPortsQuantityRow } from '@/lib/vesselPortsQuantityEdits'
export { hasVesselPortsQuantityUserEdits, quantityKgValuesEqual } from '@/lib/vesselPortsQuantityEdits'

function parseKg(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null
  return Number(value)
}

function resolveRowQty(
  row: VesselPortsQuantityRow,
  edits: VesselPortsQuantityEdits,
  field: 'quantity_delivered' | 'quantity_receive',
): number | null {
  const edited = edits[row.rowKey]?.[field]
  if (edited !== undefined) return edited
  return parseKg(row[field])
}

function formatMtRight(kg: number | null | undefined): string {
  return formatQtyMtFromKg(kg, { maxFractionDigits: 0 })
}

function sumRowsMt(
  rows: VesselPortsQuantityRow[],
  edits: VesselPortsQuantityEdits,
  field: 'contract_qty' | 'sto_qty' | 'quantity_delivered' | 'quantity_receive',
): number | null {
  let sum = 0
  let hasAny = false
  for (const row of rows) {
    let kg: number | null
    if (field === 'quantity_delivered' || field === 'quantity_receive') {
      kg = resolveRowQty(row, edits, field)
    } else {
      kg = parseKg(row[field])
    }
    if (kg !== null) {
      sum += kg
      hasAny = true
    }
  }
  return hasAny ? sum : null
}

function MtQtyInput({
  valueKg,
  disabled,
  onChange,
}: {
  valueKg: number | null
  disabled?: boolean
  onChange: (kg: number | null) => void
}) {
  const mtDisplay = valueKg === null ? '' : String(valueKg / 1000)
  return (
    <div className="relative w-full min-w-[6.5rem]">
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        value={mtDisplay}
        onKeyDown={blockCommaDecimalKeyDown}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') {
            onChange(null)
            return
          }
          if (sanitizeDecimalDotInput(raw) === null) return
          const mt = parseDecimalDotInput(raw)
          onChange(mt === null ? null : mt * 1000)
        }}
        title={DECIMAL_DOT_HINT}
        className={`h-8 text-xs pr-10 text-right tabular-nums ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">
        MT
      </span>
    </div>
  )
}

export type VesselPortsQuantitiesTableProps = {
  stoNumber: string
  rows: VesselPortsQuantityRow[]
  loading?: boolean
  editingRowKey: string | null
  edits: VesselPortsQuantityEdits
  quantityEditUnlocked: boolean
  onStartEditRow: (rowKey: string) => void
  onCancelEditRow: () => void
  onConfirmEditRow: (rowKey: string) => void
  onChangeRowQty: (
    rowKey: string,
    field: 'quantity_delivered' | 'quantity_receive',
    kg: number | null,
  ) => void
}

export function VesselPortsQuantitiesTable({
  stoNumber,
  rows,
  loading,
  editingRowKey,
  edits,
  quantityEditUnlocked,
  onStartEditRow,
  onCancelEditRow,
  onConfirmEditRow,
  onChangeRowQty,
}: VesselPortsQuantitiesTableProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        Loading contract quantities...
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
        No contract / PO rows for STO {stoNumber || '—'}.
      </div>
    )
  }

  const totals = {
    contract_qty: sumRowsMt(rows, edits, 'contract_qty'),
    sto_qty: sumRowsMt(rows, edits, 'sto_qty'),
    quantity_delivered: sumRowsMt(rows, edits, 'quantity_delivered'),
    quantity_receive: sumRowsMt(rows, edits, 'quantity_receive'),
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-left`}>Contract Ext No</TableHead>
            <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-left`}>PO</TableHead>
            <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>Contract Qty</TableHead>
            <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>STO Qty</TableHead>
            <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>Delivered Qty</TableHead>
            <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>Received Qty</TableHead>
            <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-center w-[7.5rem]`}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isEditing = editingRowKey === row.rowKey
            const deliveredKg = resolveRowQty(row, edits, 'quantity_delivered')
            const receiveKg = resolveRowQty(row, edits, 'quantity_receive')
            const qtyLocked = !quantityEditUnlocked

            return (
              <TableRow key={row.rowKey} className="hover:bg-gray-50/80">
                <TableCell className={`${VESSEL_MODAL_COMPACT_TD} font-medium`}>
                  {formatSapDisplayValue(row.contract_ext_no)}
                </TableCell>
                <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                  {formatSapDisplayValue(row.po_number)}
                </TableCell>
                <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
                  {formatMtRight(row.contract_qty)}
                </TableCell>
                <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
                  {formatMtRight(row.sto_qty)}
                  {row.locked_from_sap ? (
                    <span className="ml-1 text-[10px] text-gray-400">(SAP)</span>
                  ) : null}
                </TableCell>
                <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                  {isEditing ? (
                    <MtQtyInput
                      valueKg={deliveredKg}
                      disabled={qtyLocked}
                      onChange={(kg) => onChangeRowQty(row.rowKey, 'quantity_delivered', kg)}
                    />
                  ) : (
                    <span className="tabular-nums">{formatMtRight(deliveredKg)}</span>
                  )}
                </TableCell>
                <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                  {isEditing ? (
                    <MtQtyInput
                      valueKg={receiveKg}
                      disabled={qtyLocked}
                      onChange={(kg) => onChangeRowQty(row.rowKey, 'quantity_receive', kg)}
                    />
                  ) : (
                    <span className="tabular-nums">{formatMtRight(receiveKg)}</span>
                  )}
                </TableCell>
                <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-center`}>
                  {isEditing ? (
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        title="Cancel"
                        onClick={onCancelEditRow}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        className="h-7 w-7 bg-green-600 hover:bg-green-700 text-white"
                        title="Apply row"
                        disabled={qtyLocked}
                        onClick={() => onConfirmEditRow(row.rowKey)}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => onStartEditRow(row.rowKey)}
                    >
                      <Edit2 className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        <TableFooter>
          <TableRow className={`${VESSEL_MODAL_TABLE_FOOTER_CLASS} hover:bg-slate-50`}>
            <TableCell colSpan={2} className={`${VESSEL_MODAL_COMPACT_TD} text-xs uppercase tracking-wide text-gray-600`}>
              Grand Total ({rows.length} {rows.length === 1 ? 'row' : 'rows'})
            </TableCell>
            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
              {formatMtRight(totals.contract_qty)}
            </TableCell>
            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
              {formatMtRight(totals.sto_qty)}
            </TableCell>
            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
              {formatMtRight(totals.quantity_delivered)}
            </TableCell>
            <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right tabular-nums`}>
              {formatMtRight(totals.quantity_receive)}
            </TableCell>
            <TableCell className={VESSEL_MODAL_COMPACT_TD} />
          </TableRow>
        </TableFooter>
      </Table>
      {editingRowKey && !quantityEditUnlocked ? (
        <p className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Upload SLD or SDD (Edit mode) before changing Delivered / Received quantities.
        </p>
      ) : null}
    </div>
  )
}

/** Build table rows from contract details or a single shipment-level fallback. */
export function buildVesselPortsQuantityRows(
  shipmentId: string,
  contractDetails: Array<{
    contract_number: string
    contract_ext_no?: string | null
    po_number?: string
    contract_qty: number
    sto_qty_assigned: number
    quantity_delivered?: number | null
    quantity_receive?: number | null
    locked_from_sap?: boolean
  }> | undefined,
  fallback?: {
    contract_ext_no?: string | null
    po_number?: string
    contract_qty?: number | null
    sto_qty?: number | null
    quantity_delivered?: number | null
    quantity_receive?: number | null
  } | null,
): VesselPortsQuantityRow[] {
  if (contractDetails?.length) {
    return contractDetails.map((d) => ({
      rowKey: `${shipmentId}-${d.contract_number}`,
      contract_ext_no: d.contract_ext_no,
      po_number: d.po_number,
      contract_qty: d.contract_qty,
      sto_qty: d.sto_qty_assigned,
      quantity_delivered: d.quantity_delivered,
      quantity_receive: d.quantity_receive,
      locked_from_sap: d.locked_from_sap,
    }))
  }
  if (!fallback) return []
  return [
    {
      rowKey: `${shipmentId}__aggregate__`,
      contract_ext_no: fallback.contract_ext_no,
      po_number: fallback.po_number,
      contract_qty: fallback.contract_qty ?? null,
      sto_qty: fallback.sto_qty ?? null,
      quantity_delivered: fallback.quantity_delivered ?? null,
      quantity_receive: fallback.quantity_receive ?? null,
    },
  ]
}

export function sumVesselPortsQuantityEdits(
  rows: VesselPortsQuantityRow[],
  edits: VesselPortsQuantityEdits,
): { quantity_delivered: number | null; quantity_receive: number | null } {
  const delivered = sumRowsMt(rows, edits, 'quantity_delivered')
  const receive = sumRowsMt(rows, edits, 'quantity_receive')
  return {
    quantity_delivered: delivered,
    quantity_receive: receive,
  }
}
