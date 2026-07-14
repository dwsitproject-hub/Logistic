/**
 * Shared view-table ellipsis + hover tooltip (aligned with Shipping Performance).
 * UI-only — does not change sort / filter / calculation logic.
 */

import type { OperationalColumnLayout } from '@/lib/operationalTableLayout'

export function shouldApplyOperationalTruncateTooltip(
  colId: string,
  layout: OperationalColumnLayout,
  allowlist: ReadonlySet<string>,
): boolean {
  if (!allowlist.has(colId)) return false
  return (
    layout === 'wrap' ||
    layout === 'truncate' ||
    layout === 'short' ||
    layout === 'two_line'
  )
}

/** Default string tooltip from a row field (UI display only). */
export function operationalRowFieldTooltipText(
  colId: string,
  row: Record<string, unknown>,
): string | null {
  const raw = row[colId]
  if (raw == null) return null
  const text = String(raw).trim()
  return text && text !== '-' ? text : null
}

/** Long text columns common across operational tables. */
export const SHIPMENTS_TRUNCATE_TOOLTIP_COLUMN_IDS = new Set([
  'vessel_name',
  'product',
  'supplier',
  'loading_port',
  'discharge_port',
  'port_of_loading',
  'port_of_discharge',
  'group_name',
  'contract_ext_no',
  'contract_numbers',
  'contract_reference_po',
  'po_numbers',
])

export const TRUCKING_TRUNCATE_TOOLTIP_COLUMN_IDS = new Set([
  'product',
  'supplier',
  'location',
  'loading_location',
  'unloading_location',
  'trucking_owner',
  'contract_ext_no',
])

export const OIL_LOSS_TRUNCATE_TOOLTIP_COLUMN_IDS = new Set([
  'product',
  'incoterm',
  'group_name',
  'supplier',
  'transporter',
  'buyer',
  'plant_site',
  'loading_location',
  'unloading_location',
  'contract_ext_no',
])

export const COMMERCIAL_DOCS_TRUNCATE_TOOLTIP_COLUMN_IDS = new Set([
  'supplier',
  'product',
  'buyer',
  'plant_site',
  'contract_ext_no',
])

/** Contracts list (non–Contract Performance) — mirrors CP text columns. */
export const CONTRACTS_LIST_TRUNCATE_TOOLTIP_COLUMN_IDS = new Set([
  'supplier',
  'product',
  'source_type',
  'group_name',
  'company_name',
  'vessel_name',
  'contract_ext_no',
  'po_number',
  'over_under_delivery_status',
])
