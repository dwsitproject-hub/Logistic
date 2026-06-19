/** Display rules for Contract Detail → Logistics Information (STO table). */

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
