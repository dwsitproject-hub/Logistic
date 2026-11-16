/** Display rules for Contract Detail → Logistics Information (STO table). */

import { deriveShipmentStatus, type ShipmentMilestones } from './shipmentStatus';
import { deriveTruckingEffectiveStatus } from './truckingEffectiveStatus';
import { normalizeContractDeliveryStatusForDisplay } from './contractDeliveryStatus';

function trimOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === '-') return null;
  return text;
}

function isKlipSyntheticLogisticsKey(value: string): boolean {
  return (
    value.startsWith('OP-') ||
    value.startsWith('MNL-') ||
    value.startsWith('MSEA-')
  );
}

/** STO No column: only real SAP/contract STO values — never Operation ID or synthetic keys. */
export function resolveContractLogisticsStoNumber(stoNumber: unknown): string {
  const sto = trimOrNull(stoNumber);
  if (!sto) return '-';
  if (isKlipSyntheticLogisticsKey(sto)) return '-';
  return sto;
}

/**
 * Operation ID column: prefer operation_id; fall back to sto_key only when it is a KLIP synthetic key.
 */
export function resolveContractLogisticsOperationId(
  operationId: unknown,
  stoKey?: unknown,
): string | null {
  const op = trimOrNull(operationId);
  if (op) return op;
  const key = trimOrNull(stoKey);
  if (!key || !isKlipSyntheticLogisticsKey(key)) return null;
  return key;
}

export interface ContractLogisticsStoSummaryInput {
  sto_number?: string | null;
  operation_id?: string | null;
  sto_quantity?: number | string | null;
}

/**
 * Summary for Contract Detail Product & Quantity.
 * Real SAP STOs win; when only Operation ID rows exist, count ops and take SAP STO Qty
 * (deduped — same PO-level qty is not multiplied per operation). Never uses Contract/PO Qty.
 */
export function summarizeContractLogisticsStoQty(
  stos: readonly ContractLogisticsStoSummaryInput[],
): { sto_count: number; total_sto_quantity: number } {
  const realBySto = new Map<string, number>();
  const operationIds = new Set<string>();
  const operationQtys: number[] = [];

  for (const row of stos) {
    const sto = resolveContractLogisticsStoNumber(row.sto_number);
    const op = resolveContractLogisticsOperationId(row.operation_id, row.sto_number);
    const qtyRaw = row.sto_quantity;
    const qty =
      qtyRaw === null || qtyRaw === undefined || qtyRaw === ''
        ? 0
        : Number(qtyRaw);
    const qtyNum = Number.isFinite(qty) ? qty : 0;

    if (sto !== '-') {
      const prev = realBySto.get(sto) ?? 0;
      realBySto.set(sto, Math.max(prev, qtyNum));
      continue;
    }
    if (op) operationIds.add(op);
    if (qtyNum > 0) operationQtys.push(qtyNum);
  }

  if (realBySto.size > 0) {
    let total = 0;
    for (const q of realBySto.values()) total += q;
    return { sto_count: realBySto.size, total_sto_quantity: total };
  }

  // Operation-only fallback: count operations; qty is SAP STO Qty by PO (dedupe identical values).
  const uniqueQtys = [...new Set(operationQtys.filter((q) => q > 0))];
  const total_sto_quantity =
    uniqueQtys.length === 0
      ? 0
      : uniqueQtys.length === 1
        ? uniqueQtys[0]!
        : uniqueQtys.reduce((a, b) => a + b, 0);

  return {
    sto_count: operationIds.size,
    total_sto_quantity,
  };
}

/**
 * Contract Detail STO status: logistics workflow only (UNPLANNED … COMPLETED).
 * Contract SAP Close is separate — when contract is Close without ATA, shipment status is still COMPLETED.
 * SAP Cancelled (Delete PO / Delete STO on this line) always shows CANCELLED even without a shipment row.
 * Sticky DB CANCELLED without SAP Cancelled falls through to milestone derivation (Open → PLANNED).
 */
export function resolveContractLogisticsStoStatus(input: {
  contractImportStatus?: unknown;
  dbStatus?: unknown;
  logisticsType: 'shipment' | 'trucking';
  shipmentMilestones?: Partial<ShipmentMilestones>;
  truckingOptions?: {
    realizationStartDate?: unknown;
    realizationEndDate?: unknown;
    dailyDeliverables?: unknown;
    stoNumber?: unknown;
    /**
     * The row's OWN outstanding quantity in kg. Without it isTruckingPipelineCompleted is left
     * with "GR closed OR outstanding <= 499 kg" and no outstanding, so the tolerance arm cannot
     * fire and an Open contract can never show a Completed row - however much of it has arrived.
     */
    outstandingQtyKg?: number;
  };
}): string {
  if (input.logisticsType === 'trucking') {
    return deriveTruckingEffectiveStatus(
      input.dbStatus,
      input.truckingOptions?.realizationStartDate,
      input.truckingOptions?.realizationEndDate,
      {
        dailyDeliverables: input.truckingOptions?.dailyDeliverables,
        stoNumber: input.truckingOptions?.stoNumber,
        contractImportStatus: input.contractImportStatus,
        outstandingQtyKg: input.truckingOptions?.outstandingQtyKg,
      },
    );
  }

  const importDisplay = normalizeContractDeliveryStatusForDisplay(input.contractImportStatus);
  if (importDisplay === 'Cancelled') {
    return 'CANCELLED';
  }

  return deriveShipmentStatus({
    contract_import_status: input.contractImportStatus,
    ...input.shipmentMilestones,
  });
}

/**
 * Delivery Qty of the shipment rows in the STO table.
 *
 * A row's quantity_delivered is the shipment's own figure (KLIP or legacy) whenever SAP has nothing for the STO, and a shipment is one voyage:
 * when it carries several STOs (PO 1011003087: 1016010835 by vessel, 1016010841-45 trucked on from the terminal) that figure is the whole
 * cargo and printed 3,000 MT on every one of them. For the STOs that share a shipment the per-STO SAP delivery (sap_delivered_kg: the
 * incoterm-picked arm, then the trucking arm) is what the row shows, 0 when SAP has none - the shipment's total is no STO's delivery.
 * A shipment with a single STO keeps its value untouched, and so does a row without a shipment id.
 */
export function resolveSharedShipmentStoDelivered<T extends { id?: unknown; quantity_delivered?: unknown; sap_delivered_kg?: unknown }>(
  rows: readonly T[],
): T[] {
  const perShipment = new Map<string, number>();
  for (const row of rows) {
    const id = row.id == null ? '' : String(row.id);
    if (id) perShipment.set(id, (perShipment.get(id) ?? 0) + 1);
  }
  return rows.map((row) => {
    const id = row.id == null ? '' : String(row.id);
    if (!id || (perShipment.get(id) ?? 0) < 2) return row;
    const sap = Number(row.sap_delivered_kg);
    return { ...row, quantity_delivered: Number.isFinite(sap) && sap > 0 ? sap : 0 };
  });
}

/** SAP STO Type of a row: V (vessel) or T (truck); anything else, or nothing, is null. */
export function normalizeContractLogisticsStoType(value: unknown): 'V' | 'T' | null {
  const text = String(value ?? '').trim().toUpperCase();
  return text === 'V' || text === 'T' ? text : null;
}

export interface ContractLogisticsStoTypeSummaryRow {
  sto_type: 'V' | 'T';
  sto_count: number;
  total_sto_quantity: number;
}

/**
 * STO Quantity split by SAP STO Type (V vessel, T truck), for a cargo that travels in two legs (PO 1011003087: one V STO of 3,000 MT, five T STOs
 * of 3,008 MT). The legs are the same tonnes moved twice, so their sum is not a quantity of anything; each leg's own total is. Same rule as
 * summarizeContractLogisticsStoQty (real STOs only, the largest quantity per STO number). Returns nothing unless BOTH types are present: a contract
 * with one leg has nothing to split.
 */
export function summarizeContractLogisticsStoQtyByType(
  stos: ReadonlyArray<{ sto_number?: unknown; sto_quantity?: unknown; sto_type?: unknown }>,
): ContractLogisticsStoTypeSummaryRow[] {
  const byType = new Map<'V' | 'T', Map<string, number>>();
  for (const row of stos) {
    const type = normalizeContractLogisticsStoType(row.sto_type);
    const sto = resolveContractLogisticsStoNumber(row.sto_number);
    if (!type || sto === '-') continue;
    const qty = Number(row.sto_quantity);
    const qtyNum = Number.isFinite(qty) ? qty : 0;
    const stoMap = byType.get(type) ?? new Map<string, number>();
    stoMap.set(sto, Math.max(stoMap.get(sto) ?? 0, qtyNum));
    byType.set(type, stoMap);
  }
  if (byType.size < 2) return [];
  return (['V', 'T'] as const).map((type) => {
    const stoMap = byType.get(type) ?? new Map<string, number>();
    let total = 0;
    for (const q of stoMap.values()) total += q;
    return { sto_type: type, sto_count: stoMap.size, total_sto_quantity: total };
  });
}
