/** LOGISTICS may only patch operational readiness fields on contracts (not commercial master data). */
export const LOGISTICS_CONTRACT_EDIT_FIELDS = ['cargo_readiness_date'] as const;

export function filterContractUpdatesForRole(
  role: string | undefined,
  updates: Record<string, unknown>,
): { ok: true; updates: Record<string, unknown> } | { ok: false; message: string } {
  if (String(role ?? '').trim().toUpperCase() !== 'LOGISTICS') {
    return { ok: true, updates };
  }

  const keys = Object.keys(updates);
  const disallowed = keys.filter(
    (key) => !LOGISTICS_CONTRACT_EDIT_FIELDS.includes(key as (typeof LOGISTICS_CONTRACT_EDIT_FIELDS)[number]),
  );
  if (disallowed.length > 0) {
    return {
      ok: false,
      message: 'Logistics users may only update Cargo Readiness Date on contracts.',
    };
  }

  return { ok: true, updates };
}
