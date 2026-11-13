/**
 * The DHM status filter of a master list (All / Synced / Not synced / Failed), as SQL, so the list, its count and the summary cards on the page agree.
 *
 * The rule is the one the status icon already uses (frontend/src/lib/masterVesselDhmStatus.ts):
 *   - FAILED    the last push of the row did not reach DHM (dhm_push_state is FAILED or CONFLICT). An undelivered push wins over the link.
 *   - SYNCED    not failed, and DHM gave the row an id or a code.
 *   - NOT SYNCED  not failed, and no id or code yet.
 * It is judged in the database because the lists are paged: filtering the 20 rows on screen would hide the rest.
 */

export type MasterDhmFilter = 'all' | 'synced' | 'not_synced' | 'failed';

export function parseMasterDhmFilter(value: unknown): MasterDhmFilter {
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'synced' || v === 'not_synced' || v === 'failed' ? v : 'all';
}

export interface MasterDhmSource {
  /** The table (or its alias) the row is in: master_sites. */
  table: string;
  /** dhm_push_state.entity_kind for it: 'site'. */
  kind: string;
  /** Expressions, without the table prefix, that hold DHM's id and code on the row. */
  idColumn?: string;
  codeColumns?: string[];
}

/** The two building blocks: "the last push failed" and "DHM knows this row". Both are plain boolean SQL expressions. */
export function masterDhmConditions(source: MasterDhmSource): { failed: string; linked: string } {
  const { table, kind } = source;
  const idColumn = source.idColumn ?? 'dhm_id';
  const codeColumns = source.codeColumns ?? ['code_dhm'];
  if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(kind)) throw new Error('masterDhmConditions: unsafe identifier');
  const failed =
    `EXISTS (SELECT 1 FROM dhm_push_state ps WHERE ps.entity_kind = '${kind}' AND ps.entity_id = ${table}.id AND ps.status IN ('FAILED', 'CONFLICT'))`;
  const parts = [`COALESCE(${table}.${idColumn}::text, '') <> ''`, ...codeColumns.map((c) => `COALESCE(${table}.${c}::text, '') <> ''`)];
  return { failed, linked: `(${parts.join(' OR ')})` };
}

/** The WHERE fragment for a filter ('' for All), to be ANDed in. */
export function masterDhmFilterClause(filter: MasterDhmFilter, source: MasterDhmSource): string {
  if (filter === 'all') return '';
  const { failed, linked } = masterDhmConditions(source);
  if (filter === 'failed') return failed;
  if (filter === 'synced') return `(NOT ${failed} AND ${linked})`;
  return `(NOT ${failed} AND NOT ${linked})`;
}

/** The four counts of the summary cards in one SELECT list: total, synced, not_synced, failed (add it to a query over the table). */
export function masterDhmCountsSelect(source: MasterDhmSource): string {
  const { failed, linked } = masterDhmConditions(source);
  return [
    'COUNT(*)::int AS total',
    `COUNT(*) FILTER (WHERE NOT ${failed} AND ${linked})::int AS synced`,
    `COUNT(*) FILTER (WHERE NOT ${failed} AND NOT ${linked})::int AS not_synced`,
    `COUNT(*) FILTER (WHERE ${failed})::int AS failed`,
  ].join(',\n       ');
}
