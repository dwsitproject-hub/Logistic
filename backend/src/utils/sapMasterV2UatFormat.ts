/**
 * SAP MASTER v2 — UAT June 2026 column aliases and categorization helpers.
 * Keeps backward compatibility with the 77-column B2B template.
 */

/** Extra normalizeFieldName mappings for UAT (82-column) and SAP Data v3 (93-column) headers. */
export const SAP_MASTER_V2_UAT_FIELD_MAPPING: Record<string, string> = {
  'contract ext no': 'contract_ext_no',
  'contract ref po initial': 'contract_reference_po',
  'contract ref so initial': 'contract_reference_so',
  'gr po status': 'status',
  'gr sto status': 'gr_sto_status',
  'quantity delivery vessel': 'quantity_delivery',
  'quantity delivery trucking': 'quantity_delivery_trucking',
  'vessel loading port': 'vessel_loading_port_1',
  'transit destination': 'transit_destination',
  'discharge destination': 'discharge_destination',
  'vendor group': 'group',
  'quality at loading location ffa': 'ffa',
  'quality at loading location m&i': 'moisture',
  'quality at loading location m & i': 'moisture',
  'quality at loading location dobi': 'dobi',
  'quality at loading location red': 'color_red',
  'quality at loading location d&s': 'd_and_s',
  'quality at loading location stone': 'stone',
  'quality at discharge location ffa': 'ffa',
  'quality at discharge location m&i': 'moisture',
  'quality at discharge location m & i': 'moisture',
  'quality at discharge location dobi': 'dobi',
  'quality at discharge location red': 'color_red',
  'quality at discharge location d&s': 'd_and_s',
  'quality at discharge location stone': 'stone',
  // SAP Data v3 — UOM / currency / delete flags
  'contract qty uom': 'contract_qty_uom',
  'sto qty uom': 'sto_qty_uom',
  'delivery vessel uom': 'quantity_delivery_uom',
  'delivery trucking uom': 'quantity_delivery_trucking_uom',
  'receive uom': 'quantity_receive_uom',
  'b/l qty uom': 'bl_quantity_uom',
  'currency unit price': 'currency_unit_price',
  'currency trucking oa budget': 'currency_trucking_oa_budget',
  'currency trucking oa actual': 'currency_trucking_oa_actual',
  'delete po status': 'delete_po_status',
  'delete sto status': 'delete_sto_status',
};

/** True when Delete PO Status or Delete STO Status is non-blank (L, S, or other). */
export function hasSapDeleteFlag(parsedData: {
  contract?: Record<string, unknown> | null;
  shipment?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
}): boolean {
  const sources: Array<Record<string, unknown> | null | undefined> = [
    parsedData.contract,
    parsedData.shipment,
    parsedData.raw,
  ];
  for (const src of sources) {
    if (!src) continue;
    const po =
      src.delete_po_status ??
      src['Delete PO Status'] ??
      src['delete po status'];
    const sto =
      src.delete_sto_status ??
      src['Delete STO Status'] ??
      src['delete sto status'];
    if (po != null && String(po).trim() !== '') return true;
    if (sto != null && String(sto).trim() !== '') return true;
  }
  return false;
}

/** SQL: Delete PO Status non-blank on SPD JSON (`spd.data` or similar). */
export function sqlSpdHasDeletePoFlagExpr(spdDataExpr = 'spd.data'): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdDataExpr}->'raw'->>'Delete PO Status',
    ${spdDataExpr}->'contract'->>'delete_po_status',
    ${spdDataExpr}->'shipment'->>'delete_po_status',
    ${spdDataExpr}->>'delete_po_status'
  )), '') IS NOT NULL`;
}

/** SQL: Delete STO Status non-blank on SPD JSON. */
export function sqlSpdHasDeleteStoFlagExpr(spdDataExpr = 'spd.data'): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdDataExpr}->'raw'->>'Delete STO Status',
    ${spdDataExpr}->'contract'->>'delete_sto_status',
    ${spdDataExpr}->'shipment'->>'delete_sto_status',
    ${spdDataExpr}->>'delete_sto_status'
  )), '') IS NOT NULL`;
}

/** SQL: either Delete PO or Delete STO flag is set. */
export function sqlSpdHasAnyDeleteFlagExpr(spdDataExpr = 'spd.data'): string {
  return `(${sqlSpdHasDeletePoFlagExpr(spdDataExpr)} OR ${sqlSpdHasDeleteStoFlagExpr(spdDataExpr)})`;
}

export function isSapMasterV2UatFlatHeaderRow(headerRow: unknown[]): boolean {
  const headers = (headerRow ?? []).map((h) => String(h ?? '').trim().toLowerCase());
  return headers.includes('gr po status') || headers.includes('contract ext no');
}

export function isTruckingQuantityField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return lower.includes('quantity delivery trucking') || lower.includes('qty deliver trucking');
}

export function isShipmentQuantityField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  if (isTruckingQuantityField(fieldName)) return false;
  return (
    lower.includes('qty deliver') ||
    lower.includes('quantity delivery') ||
    lower.includes('qty receive') ||
    lower.includes('quantity receive') ||
    lower.includes('last receive')
  );
}

export function resolveSapMasterV2QualityLocation(fieldName: string): string {
  const lowerFieldName = fieldName.toLowerCase();
  if (
    lowerFieldName.includes('loading loc 1') ||
    lowerFieldName.includes('loading location 1') ||
    lowerFieldName.includes('loading port 1') ||
    (lowerFieldName.includes('loading location') &&
      !lowerFieldName.includes('loading location 2') &&
      !lowerFieldName.includes('loading location 3'))
  ) {
    return 'Loading Port 1';
  }
  if (
    lowerFieldName.includes('loading loc 2') ||
    lowerFieldName.includes('loading location 2') ||
    lowerFieldName.includes('loading port 2')
  ) {
    return 'Loading Port 2';
  }
  if (
    lowerFieldName.includes('loading loc 3') ||
    lowerFieldName.includes('loading location 3') ||
    lowerFieldName.includes('loading port 3')
  ) {
    return 'Loading Port 3';
  }
  if (lowerFieldName.includes('discharge port') || lowerFieldName.includes('discharge location')) {
    return 'Discharge Port';
  }
  return 'Unknown';
}

export function applySapMasterV2RawFieldAliases(
  raw: Record<string, unknown>,
  fieldName: string,
  value: unknown,
): void {
  const lower = fieldName.trim().toLowerCase();
  if (
    lower === 'quantity delivery' ||
    lower === 'quantity delivery vessel' ||
    lower === 'qty deliver'
  ) {
    raw['Quantity Delivered'] = value;
  }
  if (lower === 'quantity delivery trucking') {
    raw['Quantity Delivered Trucking'] = value;
  }
  if (lower === 'quantity receive' || lower === 'qty receive') {
    raw['Quantity Receive'] = value;
  }
}

/** Resolve trucking delivered qty from parsed SAP row (vessel vs trucking split). */
export function resolveSapTruckingQuantityDelivered(parsedData: {
  shipment?: Record<string, unknown>;
  trucking?: Array<{ data?: Record<string, unknown> }>;
  raw?: Record<string, unknown>;
}): unknown {
  const truckingLeg = parsedData.trucking?.[0]?.data;
  const fromLeg =
    truckingLeg?.quantity_delivery_trucking ?? truckingLeg?.quantity_delivered_via_trucking;
  if (fromLeg != null && String(fromLeg).trim() !== '') return fromLeg;

  const fromShipment = parsedData.shipment?.quantity_delivery_trucking;
  if (fromShipment != null && String(fromShipment).trim() !== '') return fromShipment;

  const raw = parsedData.raw ?? {};
  return raw['Quantity Delivery Trucking'] ?? raw['Quantity Delivered Trucking'] ?? null;
}
