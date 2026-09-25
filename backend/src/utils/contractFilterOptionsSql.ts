/**
 * The values a Contract Performance filter can actually offer, given what the other filters have
 * already narrowed the page to.
 *
 * WHY EACH LIST EXCLUDES ITS OWN FILTER. Computing every list from the fully-filtered rows is the
 * obvious approach and it is wrong: pick supplier A and the Supplier list collapses to just A, so
 * a second supplier can never be added. A value belongs in filter X's list when a row survives
 * every filter EXCEPT X - which is also what a person means by "the values that exist in this
 * table". Verified on a copy of production: with Product = CPO selected, Products still offers all
 * 32 values while Incoterms narrows 6 -> 5 and Suppliers 566 -> 334.
 *
 * ONE SCAN, six conditional aggregates. A subquery per list over a shared CTE re-reads the rows six
 * times and measured 803ms against 19,053 contracts; this measures 161ms for the same answer.
 *
 * Read from `contract_performance_snapshot`, which carries every column needed on one flat row, so
 * this is a single sequential scan - 2,120 buffers, ~10ms - instead of the joins and jsonb reads
 * the page's own query needs. A covering index was tried and the planner ignored it, correctly:
 * there is no selective predicate here, every row is read either way.
 *
 * The lists therefore lag the last SAP import by however stale the snapshot is, which is why the
 * response says so rather than pretending otherwise.
 */

export interface ContractFilterOptionSelections {
  products: string[];
  incoterms: string[];
  suppliers: string[];
  supplierGroups: string[];
  groupPlants: string[];
  sourceTypes: string[];
}

export const EMPTY_CONTRACT_FILTER_SELECTIONS: ContractFilterOptionSelections = {
  products: [],
  incoterms: [],
  suppliers: [],
  supplierGroups: [],
  groupPlants: [],
  sourceTypes: [],
};

/** Column each filter matches on, and the key its list is returned under. */
const FILTERS = [
  { key: 'products', column: 'product', flag: 'f_product' },
  { key: 'incoterms', column: 'incoterm', flag: 'f_incoterm' },
  { key: 'suppliers', column: 'supplier', flag: 'f_supplier' },
  { key: 'supplierGroups', column: 'group_name', flag: 'f_group' },
  { key: 'groupPlants', column: 'plant_site', flag: 'f_plant' },
  { key: 'sourceTypes', column: 'source_type', flag: 'f_source' },
] as const;

export type ContractFilterOptionKey = (typeof FILTERS)[number]['key'];

/** The keys, in the order the query returns them. Exported so the caller cannot drift from it. */
export const CONTRACT_FILTER_OPTION_KEYS: readonly ContractFilterOptionKey[] = FILTERS.map(
  (f) => f.key,
);

export interface ContractFilterOptionsQuery {
  text: string;
  params: unknown[];
}

/**
 * `dateFrom` / `dateTo` scope the rows the same way the page does; the selections decide which
 * values the OTHER lists may offer.
 *
 * Matching is exact on the uppercased, trimmed value - the same shape the list endpoint's own
 * `= ANY(...)` filters use, so a value offered here always returns rows when it is picked. A NULL
 * array means "this filter is not applied", which is not the same as an empty one; and because
 * Postgres evaluates OR left to right, an unapplied filter never evaluates its UPPER/TRIM at all.
 */
export function buildContractFilterOptionsQuery(
  dateFrom: string | null,
  dateTo: string | null,
  selections: ContractFilterOptionSelections,
): ContractFilterOptionsQuery {
  const params: unknown[] = [dateFrom || null, dateTo || null];

  const flagSql = FILTERS.map((f) => {
    const picked = (selections[f.key] ?? [])
      .map((v) => String(v ?? '').trim().toUpperCase())
      .filter(Boolean);
    params.push(picked.length > 0 ? picked : null);
    const idx = params.length;
    return `($${idx}::text[] IS NULL OR UPPER(TRIM(COALESCE(${f.column}, ''))) = ANY($${idx}::text[])) AS ${f.flag}`;
  });

  // ARRAY_AGG(DISTINCT ...) already returns its values sorted, so the dropdowns get an ordered list
  // without a separate ORDER BY per aggregate.
  const lists = FILTERS.map((f) => {
    const others = FILTERS.filter((o) => o.key !== f.key).map((o) => o.flag);
    return `COALESCE(ARRAY_AGG(DISTINCT TRIM(${f.column})) FILTER (WHERE ${others.join(' AND ')} AND NULLIF(TRIM(COALESCE(${f.column}, '')), '') IS NOT NULL), '{}') AS ${f.key.toLowerCase()}`;
  });

  const text = `
    WITH flagged AS (
      SELECT product, incoterm, supplier, group_name, source_type, plant_site, ${flagSql.join(', ')}
      FROM contract_performance_snapshot
      WHERE ($1::date IS NULL OR contract_date >= $1::date)
        AND ($2::date IS NULL OR contract_date <= $2::date)
    )
    SELECT ${lists.join(', ')}
    FROM flagged
  `;

  return { text, params };
}
