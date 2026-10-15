import type { ReactNode } from 'react'
import { DhmStatusBadge } from '@/components/shared/DhmStatusBadge'
import { MasterCodeBadge } from '@/components/shared/MasterCodeBadge'
import { KlipTransactionBadge } from '@/components/master-vessel/KlipTransactionBadge'
import { resolveCompactColumnWidthPx } from '@/lib/compactTableUi'
import type { MasterVesselFormData } from '@/components/master-vessel/EditVesselModal'
import { masterVesselDhmStatusLabel } from '@/lib/masterVesselDhmStatus'

/**
 * The Master Vessel table shows the columns of the vessel master sheet ("Vessel - Klip (Final Validation)", columns A-P, Ryan 2026-10-15),
 * in its order and under its headers, plus KLIP's own code and status columns (Vessel Code KLIP / DHM, Klip Transaction, DHM Status).
 * Owner Group, Year and Paired With are not in the sheet and are no longer columns; their data stays in the database.
 */
export type MasterVesselColumnId =
  | 'vessel_code'
  | 'dhm_code'
  | 'pair_code'
  | 'vessel_name'
  | 'klip_transaction'
  | 'sap_vendor_code'
  | 'vessel_owner'
  | 'vessel_capacity_mt'
  | 'vessel_type'
  | 'heating'
  | 'lambung_type'
  | 'terms'
  | 'vessel_draft'
  | 'vessel_length_overall'
  | 'vessel_hull_type'
  | 'vessel_registration_year'
  | 'vessel_codes_sap'
  | 'dhm_status'

export type MasterVesselRow = MasterVesselFormData & { id: string }

export type MasterVesselColumnMeta = {
  id: MasterVesselColumnId
  label: string
  sortable?: boolean
  getCellText: (row: MasterVesselRow) => string
  render: (row: MasterVesselRow) => ReactNode
}

function masterVesselCell(value: ReactNode): ReactNode {
  return <span className="text-sm">{value}</span>
}

/** 2500.00 -> "2,500"; 2500.5 -> "2,500.5". The API returns the NUMERIC column as a string, so the zeros come from the database. */
export function formatVesselCapacity(value: unknown): string {
  if (value == null || String(value).trim() === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** Draft / LOA in metres: "21.34" -> "21.34", "79" -> "79"; a value that is not a number is shown as it is. */
export function formatVesselMetres(value: unknown): string {
  if (value == null || String(value).trim() === '') return '-'
  const n = Number(String(value).trim().replace(',', '.'))
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function getMasterVesselCellText(colId: MasterVesselColumnId, row: MasterVesselRow): string {
  switch (colId) {
    case 'vessel_code':
      // The KLIP code, not the legacy vessel_code column. Every vessel has one and it never
      // changes, so unlike the old code there is nothing to hide behind formatVesselCodeDisplay.
      return row.vessel_code_klip || '-'
    case 'dhm_code':
      return row.dhm_code || '-'
    case 'pair_code':
      return row.pair_code || '-'
    case 'vessel_name':
      return row.vessel_name || '-'
    case 'klip_transaction':
      return row.klip_transaction ? 'Yes' : 'No'
    case 'sap_vendor_code':
      return row.sap_vendor_code || '-'
    case 'vessel_owner':
      return row.vessel_owner || '-'
    case 'vessel_capacity_mt':
      return formatVesselCapacity(row.vessel_capacity_mt)
    case 'vessel_type':
      return row.vessel_type || '-'
    case 'heating':
      return row.heating == null ? '-' : row.heating ? 'Yes' : 'No'
    case 'lambung_type':
      return row.lambung_type || '-'
    case 'terms':
      return row.terms || '-'
    case 'vessel_draft':
      return formatVesselMetres(row.vessel_draft)
    case 'vessel_length_overall':
      return formatVesselMetres(row.vessel_length_overall)
    case 'vessel_hull_type':
      return row.vessel_hull_type || '-'
    case 'vessel_registration_year':
      return row.vessel_registration_year != null ? String(row.vessel_registration_year) : '-'
    case 'vessel_codes_sap':
      return row.vessel_codes_sap || '-'
    case 'dhm_status':
      return masterVesselDhmStatusLabel(row)
    default:
      return '-'
  }
}

const BASE_WIDTH_PX: Record<MasterVesselColumnId, number> = {
  vessel_code: 112,
  dhm_code: 132,
  pair_code: 104,
  vessel_name: 176,
  klip_transaction: 120,
  sap_vendor_code: 120,
  vessel_owner: 160,
  vessel_capacity_mt: 112,
  vessel_type: 96,
  heating: 80,
  lambung_type: 104,
  terms: 104,
  vessel_draft: 96,
  vessel_length_overall: 96,
  vessel_hull_type: 120,
  vessel_registration_year: 120,
  vessel_codes_sap: 168,
  dhm_status: 108,
}

export const MASTER_VESSEL_ACTIONS_COL_WIDTH_PX = 112

const textColumn = (id: MasterVesselColumnId, label: string): MasterVesselColumnMeta => ({
  id,
  label,
  getCellText: (row) => getMasterVesselCellText(id, row),
  render: (row) => masterVesselCell(getMasterVesselCellText(id, row)),
})

export const MASTER_VESSEL_COLUMNS: MasterVesselColumnMeta[] = [
  {
    id: 'vessel_code',
    label: 'Vessel Code (KLIP)',
    getCellText: (row) => getMasterVesselCellText('vessel_code', row),
    render: (row) => <MasterCodeBadge kind="klip" value={getMasterVesselCellText('vessel_code', row)} />,
  },
  {
    id: 'dhm_code',
    label: 'Vessel Code (DHM)',
    getCellText: (row) => getMasterVesselCellText('dhm_code', row),
    render: (row) => <MasterCodeBadge kind="dhm" value={getMasterVesselCellText('dhm_code', row)} />,
  },
  {
    // The pair SAP used most recently, not a fixed assignment: a barge can change tug.
    id: 'pair_code',
    label: 'Pair ID',
    getCellText: (row) => getMasterVesselCellText('pair_code', row),
    render: (row) => <MasterCodeBadge kind="pair" value={getMasterVesselCellText('pair_code', row)} />,
  },
  textColumn('vessel_name', 'Nama Vessel'),
  {
    id: 'klip_transaction',
    label: 'Klip Transaction',
    getCellText: (row) => getMasterVesselCellText('klip_transaction', row),
    render: (row) => masterVesselCell(<KlipTransactionBadge value={row.klip_transaction} />),
  },
  // The SHIPOWNER's code in SAP (the sheet's Company Code), not the vessel's.
  textColumn('sap_vendor_code', 'Company Code'),
  textColumn('vessel_owner', 'Vessel Owner (Company Name)'),
  textColumn('vessel_capacity_mt', 'Vessel Capacity'),
  textColumn('vessel_type', 'Vessel Type'),
  textColumn('heating', 'Heating'),
  textColumn('lambung_type', 'Type Lambung'),
  textColumn('terms', 'Charter Type'),
  textColumn('vessel_draft', 'Vessel Draft'),
  textColumn('vessel_length_overall', 'Vessel LOA'),
  textColumn('vessel_hull_type', 'Vessel Hull Type'),
  textColumn('vessel_registration_year', 'Vessel Registration Year'),
  {
    // A vessel can hold several: SAP issues a code per tug/barge combination, so BG. AS MARINA 12
    // carries four. The cell shows them all and the title attribute keeps them readable when the
    // column is narrow.
    id: 'vessel_codes_sap',
    label: 'Vessel Code SAP',
    getCellText: (row) => getMasterVesselCellText('vessel_codes_sap', row),
    render: (row) => <MasterCodeBadge kind="sap" value={getMasterVesselCellText('vessel_codes_sap', row)} />,
  },
  {
    id: 'dhm_status',
    label: 'DHM Status',
    getCellText: (row) => getMasterVesselCellText('dhm_status', row),
    render: (row) => masterVesselCell(<DhmStatusBadge row={row} />),
  },
]

export function masterVesselTableColumnWidthPx(
  colId: MasterVesselColumnId,
  label?: string,
): number {
  return resolveCompactColumnWidthPx(BASE_WIDTH_PX[colId] ?? 96, label, { hasSort: true })
}

export function sumMasterVesselTableWidthPx(): number {
  return (
    MASTER_VESSEL_COLUMNS.reduce(
      (sum, col) => sum + masterVesselTableColumnWidthPx(col.id, col.label),
      0,
    ) + MASTER_VESSEL_ACTIONS_COL_WIDTH_PX
  )
}
