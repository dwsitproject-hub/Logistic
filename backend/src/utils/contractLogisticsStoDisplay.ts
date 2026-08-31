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
