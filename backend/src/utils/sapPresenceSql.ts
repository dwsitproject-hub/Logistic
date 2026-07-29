/**
 * SQL helpers for SAP presence state.
 *
 * A contract is WITHDRAWN when SAP stopped reporting its PO for 2+ consecutive trusted
 * imports, i.e. the PO was cancelled or deleted. Withdrawn contracts must not count towards
 * totals, but stay visible in lists behind a filter with their KLIP data intact.
 *
 * These are deliberately plain column predicates on `contracts`. The presence flag lives on
 * the row precisely so aggregates can filter it without an extra join or subquery - the same
 * mistake that made the shipments list 3.5x slower on 2026-07-27 was putting a per-contract
 * correlated lookup inside a filter.
 */

export type SapPresenceFilter = 'present' | 'withdrawn' | 'all';

/** Append to an aggregate's contract filter. Requires alias `c` for contracts by default. */
export function sqlExcludeWithdrawnContracts(contractAlias = 'c'): string {
  return `\n  AND ${contractAlias}.sap_presence = 'PRESENT'`;
}

/** Bare predicate (no leading AND), for composing into a WHERE list. */
export function sqlContractIsPresent(contractAlias = 'c'): string {
  return `${contractAlias}.sap_presence = 'PRESENT'`;
}

/**
 * List filter. Lists default to showing everything - a withdrawn contract still has history
 * a user may need - so 'all' contributes no predicate.
 */
export function sqlPresenceListFilter(
  filter: SapPresenceFilter,
  contractAlias = 'c',
): string {
  if (filter === 'present') return `\n  AND ${contractAlias}.sap_presence = 'PRESENT'`;
  if (filter === 'withdrawn') return `\n  AND ${contractAlias}.sap_presence = 'WITHDRAWN'`;
  return '';
}

/** Parse the query-string value into a filter, defaulting to showing everything. */
export function parsePresenceFilter(raw: unknown): SapPresenceFilter {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'present' || value === 'active') return 'present';
  if (value === 'withdrawn' || value === 'cancelled') return 'withdrawn';
  return 'all';
}
