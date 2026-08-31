export interface SapAutoImportIdentityRow {
  contractDate: string | null;
  contractNumber: string | null;
  contractExtNo: string | null;
  poNumber: string | null;
  stoNumber: string | null;
  supplier: string | null;
  remarks?: string | null;
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function pickRaw(raw: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!raw) return null;
  for (const key of keys) {
    const hit = asText(raw[key]);
    if (hit) return hit;
  }
  const lowerKeys = keys.map((k) => k.toLowerCase());
  for (const [rawKey, rawVal] of Object.entries(raw)) {
    if (lowerKeys.includes(rawKey.toLowerCase())) {
      const hit = asText(rawVal);
      if (hit) return hit;
    }
  }
  return null;
}

/** Contract Date | Contract | Contract Ext No | PO | STO | Supplier from a parsed MASTER v2 row. */
export function identityFromParsedSapRow(parsed: {
  contract?: Record<string, unknown> | null;
  shipment?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
}): SapAutoImportIdentityRow {
  const contract = parsed.contract ?? {};
  const shipment = parsed.shipment ?? {};
  const raw = parsed.raw ?? {};

  return {
    contractDate:
      asText(contract.contract_date) ||
      pickRaw(raw, ['Contract Date', 'contract_date', 'PO Date']),
    contractNumber:
      asText(contract.contract_no) ||
      pickRaw(raw, ['Contract No', 'Contract No.', 'contract_no', 'Contract Number']),
    contractExtNo:
      asText(contract.contract_ext_no) ||
      pickRaw(raw, ['Contract Ext No', 'contract_ext_no']),
    poNumber:
      asText(contract.po_no) || pickRaw(raw, ['PO No', 'PO No.', 'po_no', 'PO Number']),
    stoNumber:
      asText(shipment.sto_no) ||
      asText(contract.sto_no) ||
      pickRaw(raw, ['STO No', 'STO No.', 'sto_no', 'STO Number']),
    supplier:
      asText(contract.supplier) ||
      pickRaw(raw, ['Supplier', 'Supplier (vendor -> name 1))', 'supplier']),
  };
}

export const SAP_AUTO_IMPORT_SUCCESS_HEADERS = [
  'Contract Date',
  'Contract',
  'Contract Ext No',
  'PO',
  'STO',
  'Supplier',
] as const;

export const SAP_AUTO_IMPORT_FAILED_HEADERS = [
  ...SAP_AUTO_IMPORT_SUCCESS_HEADERS,
  'Remarks',
] as const;

export function identityToSuccessCells(row: SapAutoImportIdentityRow): string[] {
  return [
    row.contractDate ?? '',
    row.contractNumber ?? '',
    row.contractExtNo ?? '',
    row.poNumber ?? '',
    row.stoNumber ?? '',
    row.supplier ?? '',
  ];
}

export function identityToFailedCells(row: SapAutoImportIdentityRow): string[] {
  return [...identityToSuccessCells(row), row.remarks ?? ''];
}
