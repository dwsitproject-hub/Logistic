/**
 * SAP MASTER v2 — UAT June 2026 column aliases and categorization helpers.
 * Keeps backward compatibility with the 77-column B2B template.
 */

/** Extra normalizeFieldName mappings for UAT (82-column) headers. */
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
};

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
