/** Display rules for Contract Detail → Logistics Information (STO table). */

import { deriveShipmentStatus, type ShipmentMilestones } from './shipmentStatus';
import { deriveTruckingEffectiveStatus } from './truckingEffectiveStatus';

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

/**
 * Contract Detail STO status: logistics workflow only (UNPLANNED … COMPLETED).
 * Contract SAP Close is separate — when contract is Close without ATA, shipment status is still COMPLETED.
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

  return deriveShipmentStatus({
    contract_import_status: input.contractImportStatus,
    ...input.shipmentMilestones,
  });
}
