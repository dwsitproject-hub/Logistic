/**
 * Shipments View Table "Download Table" — visible columns only, values match the table.
 *
 * Numbers are exported as numbers with the unit in the header ("Contract Qty (MT)"), so the file
 * can be summed and counted; see exportNumbers.ts.
 */

import { computeLateIndicatorDisplay } from '@/lib/calendarDays'
import { formatDateDMY } from '@/lib/dateFormat'
import { resolveShipmentListDischargePorts, resolveShipmentListLoadingPorts } from '@/lib/shipmentListPorts'
import { resolveShipmentListSuppliers } from '@/lib/shipmentListSuppliers'
import { resolveShipmentDisplayStoNumber } from '@/lib/shipmentStoDisplay'
import {
  resolveShipmentListStoKg,
  shipmentListDeliveredKgForViewTable,
  shipmentListOutstandingKgForViewTable,
  shipmentListReceiveKgForViewTable,
} from '@/lib/shipmentQuantityUnits'
import {
  formatOperationalTableTextDisplayForColumn,
  formatVesselTableDisplay,
} from '@/lib/sapDisplayValue'
import { exportHeaderWithUnit, exportNumberCell, kgToMtNumber } from '@/lib/exportNumbers'

export interface ShipmentViewTableExportColumn {
  id: string
  label: string
}

export const SHIPMENT_EXPORT_DATE_COLUMN_IDS = new Set([
  'contract_date',
  'delivery_start',
  'delivery_end',
  'ata_vessel_completed_loading',
  'ata_vessel_complete_discharge',
  'eta_vessel_complete_discharge',
  'created_at',
  'eta_arrival',
  'eta_berthed',
  'eta_loading_start',
  'eta_loading_complete',
  'eta_sailed',
  'eta_discharge_arrival',
  'eta_discharge_berthed',
  'eta_discharge_start',
  'eta_discharge_complete',
  'ata_vessel_arrival_at_loading_port',
  'ata_vessel_berthed_at_loading_port',
  'ata_vessel_start_loading',
  'ata_vessel_sailed_from_loading_port',
  'ata_vessel_arrive_at_discharge_port',
  'ata_vessel_berthed_at_discharge_port',
  'ata_vessel_start_discharging',
])

const DATE_FIELD_BY_COLUMN_ID: Record<string, string> = {
  delivery_start: 'delivery_start_date',
  delivery_end: 'delivery_end_date',
}

/** Columns whose table cell is "<number> <unit>"; 0 means "not filled" there, so it exports blank. */
const NUMBER_UNIT_BY_COLUMN_ID: Record<string, string> = {
  estimated_nautical_miles: 'NM',
  vessel_draft: 'm',
  vessel_loa: 'm',
  vessel_capacity: 'Kg',
  average_vessel_speed: 'knots',
}

/** Unit shown in the export header of a numeric column; the cell itself is a bare number. */
export const SHIPMENT_EXPORT_UNIT_BY_COLUMN_ID: Record<string, string> = {
  contract_qty: 'MT',
  sto_quantity: 'MT',
  quantity_delivered: 'MT',
  quantity_receive: 'MT',
  outstanding_quantity: 'MT',
  outstanding_qty_planning: 'MT',
  sfal_qty: 'MT',
  sfbd_qty: 'MT',
  trade_cycle_days: 'days',
  gain_loss_percentage: '%',
  ...NUMBER_UNIT_BY_COLUMN_ID,
}

function asRecord(row: object): Record<string, unknown> {
  return row as Record<string, unknown>
}

function dashIfEmpty(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined || value === '') return '-'
  return value
}

function isContractBacklog(row: Record<string, unknown>): boolean {
  return String(row.row_kind ?? '').trim() === 'contract_backlog'
}

export function resolveShipmentViewTableExportCell(
  column: ShipmentViewTableExportColumn,
  row: object,
): string | number {
  const id = column.id
  const rec = asRecord(row)

  if (id === 'late_indicator') {
    return computeLateIndicatorDisplay(
      rec.delivery_end_date,
      rec.ata_vessel_complete_discharge,
      rec.eta_vessel_complete_discharge,
    ).text
  }
  if (id === 'shipment_id' || id === 'sto_number') {
    if (isContractBacklog(rec)) return '-'
    return resolveShipmentDisplayStoNumber(rec.sto_number)
  }
  if (id === 'pre_planned_group') {
    const code = String(rec.pre_planned_group_code ?? rec.group_code ?? '').trim()
    return code || '-'
  }
  if (id === 'loading_port') {
    return formatOperationalTableTextDisplayForColumn(
      id,
      resolveShipmentListLoadingPorts(rec as Parameters<typeof resolveShipmentListLoadingPorts>[0]),
    )
  }
  if (id === 'discharge_port') {
    return formatOperationalTableTextDisplayForColumn(
      id,
      resolveShipmentListDischargePorts(rec as Parameters<typeof resolveShipmentListDischargePorts>[0]),
    )
  }
  if (id === 'supplier') {
    return formatOperationalTableTextDisplayForColumn(id, resolveShipmentListSuppliers(rec))
  }
  if (id === 'vessel_name') {
    return formatVesselTableDisplay(rec.vessel_name)
  }
  if (id === 'contract_ext_no') {
    return formatOperationalTableTextDisplayForColumn(
      id,
      rec.contract_ext_no ?? rec.contract_number,
    )
  }
  if (id === 'contract_numbers') {
    return formatOperationalTableTextDisplayForColumn(
      id,
      rec.contract_numbers ?? rec.contract_number,
    )
  }
  if (id === 'po_numbers') {
    return formatOperationalTableTextDisplayForColumn(id, rec.po_numbers ?? rec.po_number)
  }
  if (id === 'freight_budget') {
    return exportNumberCell(rec.vessel_oa_budget)
  }
  // Quantities: exact MT as a number; a missing value is 0, as in the table. Outstanding keeps its
  // sign (negative = over-delivered, shown as "+N MT" on screen) so the column nets out when summed.
  if (id === 'contract_qty') {
    return kgToMtNumber(rec.contract_qty)
  }
  if (id === 'sto_quantity') {
    return kgToMtNumber(resolveShipmentListStoKg(rec))
  }
  if (id === 'quantity_delivered') {
    return kgToMtNumber(shipmentListDeliveredKgForViewTable(rec))
  }
  if (id === 'quantity_receive') {
    return kgToMtNumber(shipmentListReceiveKgForViewTable(rec))
  }
  if (id === 'outstanding_quantity') {
    return kgToMtNumber(shipmentListOutstandingKgForViewTable(rec))
  }
  if (id === 'outstanding_qty_planning') {
    return kgToMtNumber(rec.outstanding_qty_planning)
  }
  if (id === 'trade_cycle_days') {
    // The table shows the magnitude only (late/ahead is colour), so the export does the same.
    const n = exportNumberCell(rec.trade_cycle_days)
    return n === '' ? '' : Math.abs(n)
  }
  if (id === 'sfal_qty' || id === 'sfbd_qty') {
    return kgToMtNumber(rec[id])
  }
  if (SHIPMENT_EXPORT_DATE_COLUMN_IDS.has(id)) {
    const field = DATE_FIELD_BY_COLUMN_ID[id] ?? id
    const raw = rec[field]
    return raw ? formatDateDMY(String(raw)) : '-'
  }
  if (NUMBER_UNIT_BY_COLUMN_ID[id]) {
    const n = exportNumberCell(rec[id])
    return n === '' || n === 0 ? '' : n
  }
  if (
    id === 'fuel_consumption' ||
    id === 'freight' ||
    id === 'pump_rate' ||
    id === 'sailing_speed' ||
    id === 'shortage' ||
    id === 'gain_loss_percentage' ||
    id === 'gain_loss_amount' ||
    id === 'vessel_registration_year'
  ) {
    // Blank when missing so COUNT counts only filled rows. A year is a bare number as well: no
    // thousands separator.
    return exportNumberCell(rec[id])
  }

  return dashIfEmpty(formatOperationalTableTextDisplayForColumn(id, rec[id]))
}

export function buildShipmentViewTableExportMatrix(
  visibleColumns: ShipmentViewTableExportColumn[],
  rows: object[],
): (string | number)[][] {
  const header = visibleColumns.map((col) =>
    exportHeaderWithUnit(col.label, SHIPMENT_EXPORT_UNIT_BY_COLUMN_ID[col.id]),
  )
  const body = rows.map((row) =>
    visibleColumns.map((col) => resolveShipmentViewTableExportCell(col, row)),
  )
  return [header, ...body]
}
