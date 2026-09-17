import type { ReactNode } from 'react'
import { resolveCompactColumnWidthPx } from '@/lib/compactTableUi'
import { formatVesselCodeDisplay } from '@/lib/formatVesselCodeDisplay'
import type { MasterVesselFormData } from '@/components/master-vessel/EditVesselModal'

export type MasterVesselColumnId =
  | 'vessel_code'
  | 'vessel_name'
  | 'vessel_capacity_mt'
  | 'vessel_owner'
  | 'vessel_owner_group'
  | 'sap_vendor_code'
  | 'vessel_type'
  | 'year_of_creation'
  | 'heating'
  | 'lambung_type'
  | 'terms'

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

export function getMasterVesselCellText(colId: MasterVesselColumnId, row: MasterVesselRow): string {
  switch (colId) {
    case 'vessel_code':
      return formatVesselCodeDisplay(row.vessel_code)
    case 'vessel_name':
      return row.vessel_name || '-'
    case 'vessel_capacity_mt':
      return row.vessel_capacity_mt != null ? String(row.vessel_capacity_mt) : '-'
    case 'vessel_owner':
      return row.vessel_owner || '-'
    case 'vessel_owner_group':
      return row.vessel_owner_group || '-'
    case 'sap_vendor_code':
      return row.sap_vendor_code || '-'
    case 'vessel_type':
      return row.vessel_type || '-'
    case 'year_of_creation':
      return row.year_of_creation != null ? String(row.year_of_creation) : '-'
    case 'heating':
      return row.heating == null ? '-' : row.heating ? 'Yes' : 'No'
    case 'lambung_type':
      return row.lambung_type || '-'
    case 'terms':
      return row.terms || '-'
    default:
      return '-'
  }
}

const BASE_WIDTH_PX: Record<MasterVesselColumnId, number> = {
  vessel_code: 108,
  vessel_name: 176,
  vessel_capacity_mt: 112,
  vessel_owner: 128,
  vessel_owner_group: 128,
  sap_vendor_code: 120,
  vessel_type: 96,
  year_of_creation: 72,
  heating: 80,
  lambung_type: 104,
  terms: 80,
}

export const MASTER_VESSEL_ACTIONS_COL_WIDTH_PX = 96

export const MASTER_VESSEL_COLUMNS: MasterVesselColumnMeta[] = [
  {
    id: 'vessel_code',
    label: 'Vessel Code',
    getCellText: (row) => getMasterVesselCellText('vessel_code', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('vessel_code', row)),
  },
  {
    id: 'vessel_name',
    label: 'Vessel Name',
    getCellText: (row) => getMasterVesselCellText('vessel_name', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('vessel_name', row)),
  },
  {
    id: 'vessel_capacity_mt',
    label: 'Capacity (MT)',
    getCellText: (row) => getMasterVesselCellText('vessel_capacity_mt', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('vessel_capacity_mt', row)),
  },
  {
    id: 'vessel_owner',
    label: 'Owner',
    getCellText: (row) => getMasterVesselCellText('vessel_owner', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('vessel_owner', row)),
  },
  {
    id: 'vessel_owner_group',
    label: 'Owner Group',
    getCellText: (row) => getMasterVesselCellText('vessel_owner_group', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('vessel_owner_group', row)),
  },
  {
    id: 'sap_vendor_code',
    label: 'SAP Vendor Code',
    getCellText: (row) => getMasterVesselCellText('sap_vendor_code', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('sap_vendor_code', row)),
  },
  {
    id: 'vessel_type',
    label: 'Vessel Type',
    getCellText: (row) => getMasterVesselCellText('vessel_type', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('vessel_type', row)),
  },
  {
    id: 'year_of_creation',
    label: 'Year',
    getCellText: (row) => getMasterVesselCellText('year_of_creation', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('year_of_creation', row)),
  },
  {
    id: 'heating',
    label: 'Heating',
    getCellText: (row) => getMasterVesselCellText('heating', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('heating', row)),
  },
  {
    id: 'lambung_type',
    label: 'Lambung Type',
    getCellText: (row) => getMasterVesselCellText('lambung_type', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('lambung_type', row)),
  },
  {
    id: 'terms',
    label: 'Terms',
    getCellText: (row) => getMasterVesselCellText('terms', row),
    render: (row) => masterVesselCell(getMasterVesselCellText('terms', row)),
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
