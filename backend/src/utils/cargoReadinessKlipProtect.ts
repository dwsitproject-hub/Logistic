export const CARGO_READINESS_KLIP_SKIP_REASON = 'KLIP-edited — not replaced';

export type CargoReadinessExcelRowOutcome = 'not_found' | 'skipped' | 'update';

/**
 * When Cargo Readiness Date is saved from Contract Details (PUT), mark the row
 * so Excel bulk upload cannot replace it. Client cannot clear this flag.
 */
export function applyCargoReadinessKlipEditFlag(
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...updates };
  delete next.cargo_readiness_klip_edited;
  if (Object.prototype.hasOwnProperty.call(updates, 'cargo_readiness_date')) {
    next.cargo_readiness_klip_edited = true;
  }
  return next;
}

export function classifyCargoReadinessExcelContract(
  contract: { cargo_readiness_klip_edited?: boolean | null } | null | undefined,
): CargoReadinessExcelRowOutcome {
  if (!contract) return 'not_found';
  if (contract.cargo_readiness_klip_edited === true) return 'skipped';
  return 'update';
}
