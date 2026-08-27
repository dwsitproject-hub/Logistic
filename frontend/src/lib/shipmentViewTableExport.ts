/**
 * Shipments View Table "Download Table" — visible columns only, values match the table.
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
  formatSapDisplayNumber,
  formatSapOutstandingQtyMtDisplay,
  formatSapQtyMtDisplay,
  formatVesselTableDisplay,
} from '@/lib/sapDisplayValue'

export interface ShipmentViewTableExportColumn {
  id: string
  label: string
}

const QTY_MT_OPTS = { maxFractionDigits: 0 } as const

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

const NUMBER_SUFFIX_BY_COLUMN_ID: Record<string, string> = {
  estimated_nautical_miles: ' NM',
  vessel_draft: ' m',
  vessel_loa: ' m',
  vessel_capacity: ' Kg',
  average_vessel_speed: ' knots',
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
    return rec.vessel_oa_budget == null || rec.vessel_oa_budget === ''
      ? '-'
      : formatSapDisplayNumber(rec.vessel_oa_budget as number | string | null)
  }
  if (id === 'contract_qty') {
    return formatSapQtyMtDisplay(rec.contract_qty as number | string | null, QTY_MT_OPTS)
  }
  if (id === 'sto_quantity') {
    const kg = resolveShipmentListStoKg(rec)
    return kg == null ? '-' : formatSapQtyMtDisplay(kg, QTY_MT_OPTS)
  }
  if (id === 'quantity_delivered') {
    return formatSapQtyMtDisplay(shipmentListDeliveredKgForViewTable(rec), QTY_MT_OPTS)
  }
  if (id === 'quantity_receive') {
    return formatSapQtyMtDisplay(shipmentListReceiveKgForViewTable(rec), QTY_MT_OPTS)
  }
  if (id === 'outstanding_quantity') {
    const kg = shipmentListOutstandingKgForViewTable(rec)
    if (kg == null) return '-'
    return formatSapOutstandingQtyMtDisplay(kg, QTY_MT_OPTS)
  }
  if (id === 'outstanding_qty_planning') {
    if (rec.outstanding_qty_planning == null || rec.outstanding_qty_planning === '') return '-'
    return formatSapOutstandingQtyMtDisplay(
      rec.outstanding_qty_planning as number | string | null,
      QTY_MT_OPTS,
    )
  }
  if (id === 'sfal_qty' || id === 'sfbd_qty') {
    return formatSapQtyMtDisplay(rec[id] as number | string | null, QTY_MT_OPTS)
  }
  if (SHIPMENT_EXPORT_DATE_COLUMN_IDS.has(id)) {
    const field = DATE_FIELD_BY_COLUMN_ID[id] ?? id
    const raw = rec[field]
    return raw ? formatDateDMY(String(raw)) : '-'
  }
  const suffix = NUMBER_SUFFIX_BY_COLUMN_ID[id]
  if (suffix) {
    const n = rec[id]
    if (n == null || n === '' || n === 0) return '-'
    return `${formatSapDisplayNumber(n as number | string)}${suffix}`
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
    if (rec[id] == null || rec[id] === '') return '-'
    if (id === 'gain_loss_percentage') {
      const formatted = formatSapDisplayNumber(rec[id] as number | string)
      return formatted === '-' ? '-' : `${formatted}%`
    }
    return formatSapDisplayNumber(rec[id] as number | string)
  }

  return dashIfEmpty(formatOperationalTableTextDisplayForColumn(id, rec[id]))
}

export function buildShipmentViewTableExportMatrix(
  visibleColumns: ShipmentViewTableExportColumn[],
  rows: object[],
): (string | number)[][] {
  const header = visibleColumns.map((col) => col.label)
  const body = rows.map((row) =>
    visibleColumns.map((col) => resolveShipmentViewTableExportCell(col, row)),
  )
  return [header, ...body]
}
