import { sqlExcludeDhmDeleted, wantsExcludeDhmDeleted } from './dhmDeletedFilter';
import { sqlResolveMasterVesselIdFromShipment } from './masterVesselCanonicalSql';

/**
 * SAP codes for one vessel, newest-first by primary then code. A vessel can hold several - SAP
 * issues a code per tug/barge combination, so BG. AS MARINA 12 carries four - which is why this is
 * an aggregate and not a column. Only namespace='SAP' rows appear: the same table also holds the
 * vessel's KLIP-invented legacy codes.
 */
export const MASTER_VESSEL_SAP_CODES_SQL = `(
  SELECT string_agg(a.vessel_code, ', ' ORDER BY a.is_primary DESC, a.vessel_code)
  FROM master_vessel_code_aliases a
  WHERE a.master_vessel_id = master_vessels.id
    AND a.namespace = 'SAP'
)`;

/**
 * Per pair, the newest contract date of a shipment whose vessel name is one of the pair's SAP names (vessel_pair_sap_names), with the
 * same letters-and-digits key as sapNameKey in vesselMasterLoad.service. A pair that no shipment names is absent. It is the first entry of
 * the WITH list of both the list and the count query, because MASTER_VESSEL_USED_IDS_CTE and MASTER_VESSEL_PAIR_CTE read it.
 */
export const MASTER_VESSEL_PAIR_USE_CTE = `pair_use AS (
  SELECT n.pair_id, MAX(u.last_date) AS last_used
  FROM vessel_pair_sap_names n
  INNER JOIN (
    SELECT regexp_replace(upper(s.vessel_name), '[^A-Z0-9]', '', 'g') AS k,
           MAX(COALESCE(c.contract_date, s.created_at::date)) AS last_date
    FROM shipments s
    LEFT JOIN contracts c ON c.id = s.contract_id
    WHERE NULLIF(trim(s.vessel_name), '') IS NOT NULL
    GROUP BY 1
  ) u ON u.k = n.normalized_sap_name
  GROUP BY n.pair_id
)`;

/**
 * Master vessel ids that at least one shipment resolves to. Shipments are where both SAP imports and Add New Shipment land, and
 * sqlResolveMasterVesselIdFromShipment is the same resolution the rest of KLIP uses (stored id, then SAP code alias, then code,
 * then normalised name), so "has a KLIP transaction" agrees with where the vessel actually shows up. It runs over the distinct
 * (id, code, name) triples, not every shipment row, because the resolution is a correlated lookup.
 *
 * Both halves of a pair count. A shipment carries ONE master_vessel_id, and SAP sends a tug and a barge as one combined name under one code,
 * so the shipment resolved to only one of them and its partner read "No" although it sailed on the same shipments. Every vessel of a pair
 * that a shipment names (MASTER_VESSEL_PAIR_USE_CTE) is therefore used, whichever side the shipment's own id points at.
 *
 * A query that uses it must start with `WITH ${MASTER_VESSEL_PAIR_USE_CTE}, ${MASTER_VESSEL_USED_IDS_CTE}`; the NULL filter is there because
 * `x IN (subquery with a NULL)` is NULL, not false, when nothing matches.
 */
export const MASTER_VESSEL_USED_IDS_CTE = `used_vessels AS (
  SELECT r.id
  FROM (
    SELECT DISTINCT ${sqlResolveMasterVesselIdFromShipment('sv')} AS id
    FROM (SELECT DISTINCT master_vessel_id, vessel_code, vessel_name FROM shipments) sv
  ) r
  WHERE r.id IS NOT NULL
  UNION
  SELECT v.vessel_id
  FROM pair_use pu
  INNER JOIN vessel_pairs p ON p.id = pu.pair_id
  CROSS JOIN LATERAL (VALUES (p.tb_master_vessel_id), (p.bg_master_vessel_id)) AS v(vessel_id)
)`;

/**
 * The tug/barge pair a vessel is in NOW, one row per vessel, for the Pair ID column.
 *
 * A vessel can sit in several vessel_pairs rows (a barge pulled by another tug later), and the workbook only knows the pairs of its
 * day, so the pair is chosen by the latest SAP usage, not by pair_code: each pair's SAP names (vessel_pair_sap_names) are matched
 * against the vessel names shipments carry, and the pair whose name appeared on the newest contract wins. A pair with no match
 * falls back to the contract date the workbook recorded. Same letters-and-digits-only key as sapNameKey in vesselMasterLoad.service.
 *
 * A pair SAP started sending after the workbook is not in vessel_pairs, so it cannot win here until it is registered.
 *
 * List query only, after MASTER_VESSEL_PAIR_USE_CTE in the WITH list; then LEFT JOIN vessel_pair_latest.
 */
export const MASTER_VESSEL_PAIR_CTE = `vessel_pair_latest AS (
  SELECT DISTINCT ON (side.vessel_id)
         side.vessel_id,
         p.pair_code,
         pm.vessel_name AS pair_partner_name,
         COALESCE(pu.last_used, p.last_contract_date) AS pair_last_used
  FROM (
    SELECT id AS pair_id, tb_master_vessel_id AS vessel_id, bg_master_vessel_id AS partner_id FROM vessel_pairs
    UNION ALL
    SELECT id, bg_master_vessel_id, tb_master_vessel_id FROM vessel_pairs
  ) side
  INNER JOIN vessel_pairs p ON p.id = side.pair_id
  INNER JOIN master_vessels pm ON pm.id = side.partner_id
  LEFT JOIN pair_use pu ON pu.pair_id = p.id
  ORDER BY side.vessel_id, COALESCE(pu.last_used, p.last_contract_date) DESC NULLS LAST, p.pair_code
)`;

/** True when the vessel, or the pair it is in, is on at least one shipment. Needs MASTER_VESSEL_USED_IDS_CTE in the same query. */
export const MASTER_VESSEL_KLIP_TRANSACTION_SQL = `EXISTS (SELECT 1 FROM used_vessels u WHERE u.id = master_vessels.id)`;

/** Parse repeated or comma-separated query params into string[]. */
export function parseMultiQueryParam(raw: unknown): string[] {
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  const values: string[] = [];
  for (const part of parts) {
    const s = String(part ?? '').trim();
    if (!s) continue;
    for (const token of s.split(',')) {
      const t = token.trim();
      if (t) values.push(t);
    }
  }
  return [...new Set(values)];
}

export const MASTER_VESSEL_TYPE_OPTIONS = ['BARGE', 'TANKER', 'SPOB', 'TUG BOAT'] as const;
export const MASTER_VESSEL_LAMBUNG_OPTIONS = ['DHDB', 'SHSB', 'SHDB'] as const;
export const MASTER_VESSEL_TERMS_OPTIONS = ['T/C', 'V/C', 'CIF'] as const;

export type MasterVesselListFilterParams = {
  search?: string;
  owners?: string[];
  vesselTypes?: string[];
  heating?: string[];
  lambungTypes?: string[];
  terms?: string[];
  /** 'yes' / 'no' (a vessel with / without a shipment). Both or neither = no filter. The query must carry MASTER_VESSEL_USED_IDS_CTE. */
  klipTransaction?: string[];
  /** Pickers only: leave out vessels deleted in DHM. The Master Vessel table does not set it. */
  excludeDhmDeleted?: boolean;
};

export function buildMasterVesselListWhere(
  filters: MasterVesselListFilterParams,
): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  let where = 'WHERE 1=1';
  where += sqlExcludeDhmDeleted(filters.excludeDhmDeleted === true);

  if (filters.search && filters.search.trim().length > 0) {
    params.push(`%${filters.search.trim()}%`);
    where += ` AND (
      vessel_code ILIKE $${params.length}
      OR vessel_code_klip ILIKE $${params.length}
      OR dhm_code ILIKE $${params.length}
      OR vessel_name ILIKE $${params.length}
      OR normalized_vessel_name ILIKE $${params.length}
      OR EXISTS (
        SELECT 1 FROM master_vessel_code_aliases a
        WHERE a.master_vessel_id = master_vessels.id
          AND a.vessel_code ILIKE $${params.length}
      )
      OR (code_status = 'PROVISIONAL' AND vessel_name ILIKE $${params.length})
    )`;
  }

  if (filters.owners && filters.owners.length > 0) {
    params.push(filters.owners.map((o) => o.toUpperCase()));
    where += ` AND upper(trim(vessel_owner)) = ANY($${params.length}::text[])`;
  }

  if (filters.vesselTypes && filters.vesselTypes.length > 0) {
    params.push(filters.vesselTypes.map((t) => t.toUpperCase()));
    where += ` AND upper(trim(vessel_type)) = ANY($${params.length}::text[])`;
  }

  if (filters.lambungTypes && filters.lambungTypes.length > 0) {
    params.push(filters.lambungTypes.map((t) => t.toUpperCase()));
    where += ` AND upper(trim(lambung_type)) = ANY($${params.length}::text[])`;
  }

  if (filters.heating && filters.heating.length > 0) {
    const normalized = filters.heating.map((h) => h.toLowerCase());
    const wantsTrue = normalized.includes('true') || normalized.includes('yes');
    const wantsFalse = normalized.includes('false') || normalized.includes('no');
    const wantsBlank = normalized.includes('blank');
    const clauses: string[] = [];
    if (wantsTrue) clauses.push('heating = true');
    if (wantsFalse) clauses.push('heating = false');
    if (wantsBlank) clauses.push('heating IS NULL');
    if (clauses.length > 0) {
      where += ` AND (${clauses.join(' OR ')})`;
    }
  }

  if (filters.terms && filters.terms.length > 0) {
    const normalized = filters.terms.map((t) => t.toUpperCase());
    const wantsBlank = normalized.includes('BLANK');
    const valueTerms = normalized.filter((t) => t === 'T/C' || t === 'V/C' || t === 'CIF');
    const clauses: string[] = [];
    if (valueTerms.length > 0) {
      params.push(valueTerms);
      clauses.push(`terms = ANY($${params.length}::text[])`);
    }
    if (wantsBlank) clauses.push('terms IS NULL');
    if (clauses.length > 0) {
      where += ` AND (${clauses.join(' OR ')})`;
    }
  }

  if (filters.klipTransaction && filters.klipTransaction.length > 0) {
    const normalized = filters.klipTransaction.map((v) => v.toLowerCase());
    const wantsYes = normalized.includes('yes') || normalized.includes('true');
    const wantsNo = normalized.includes('no') || normalized.includes('false');
    if (wantsYes && !wantsNo) where += ` AND ${MASTER_VESSEL_KLIP_TRANSACTION_SQL}`;
    if (wantsNo && !wantsYes) where += ` AND NOT ${MASTER_VESSEL_KLIP_TRANSACTION_SQL}`;
  }

  return { where, params };
}

export const MASTER_VESSEL_SORT_COLUMNS: Record<string, string> = {
  // The table's "Vessel Code (KLIP)" column keeps the id `vessel_code` so saved column order
  // survives, but it shows - and therefore sorts by - the KLIP code.
  vessel_code: 'vessel_code_klip',
  vessel_code_klip: 'vessel_code_klip',
  vessel_codes_sap: MASTER_VESSEL_SAP_CODES_SQL,
  dhm_code: 'dhm_code',
  vessel_name: 'vessel_name',
  vessel_capacity_mt: 'vessel_capacity_mt',
  vessel_owner: 'vessel_owner',
  vessel_owner_group: 'vessel_owner_group',
  sap_vendor_code: 'sap_vendor_code',
  vessel_type: 'vessel_type',
  year_of_creation: 'year_of_creation',
  heating: 'heating',
  lambung_type: 'lambung_type',
  terms: 'terms',
  dhm_status: `(dhm_id IS NOT NULL OR NULLIF(BTRIM(dhm_code), '') IS NOT NULL)`,
  klip_transaction: MASTER_VESSEL_KLIP_TRANSACTION_SQL,
  // vessel_pair_latest is joined in the list query only (the count query has no sort).
  pair_code: 'vessel_pair_latest.pair_code',
  pair_partner_name: 'vessel_pair_latest.pair_partner_name',
};

export function buildMasterVesselOrderBy(sortKey?: string, sortDir?: string): string {
  const col =
    sortKey && MASTER_VESSEL_SORT_COLUMNS[sortKey]
      ? MASTER_VESSEL_SORT_COLUMNS[sortKey]
      : 'vessel_name';
  const dir = String(sortDir ?? '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  if (col === 'vessel_name') {
    return `ORDER BY vessel_name ${dir} NULLS LAST, vessel_code ${dir} NULLS LAST`;
  }
  return `ORDER BY ${col} ${dir} NULLS LAST, vessel_name ASC, vessel_code ASC`;
}

export function parseMasterVesselListQuery(query: Record<string, unknown>): MasterVesselListFilterParams & {
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
} {
  const search = typeof query.search === 'string' ? query.search.trim() : undefined;
  const sortKeyRaw = typeof query.sortKey === 'string' ? query.sortKey.trim() : '';
  const sortKey = sortKeyRaw && MASTER_VESSEL_SORT_COLUMNS[sortKeyRaw] ? sortKeyRaw : undefined;
  const sortDirRaw = String(query.sortDir ?? '').toLowerCase();
  const sortDir: 'asc' | 'desc' = sortDirRaw === 'desc' ? 'desc' : 'asc';
  return {
    search: search || undefined,
    owners: parseMultiQueryParam(query.owners),
    vesselTypes: parseMultiQueryParam(query.vesselTypes),
    heating: parseMultiQueryParam(query.heating),
    lambungTypes: parseMultiQueryParam(query.lambungTypes),
    terms: parseMultiQueryParam(query.terms),
    klipTransaction: parseMultiQueryParam(query.klipTransaction),
    excludeDhmDeleted: wantsExcludeDhmDeleted(query.excludeDeleted),
    sortKey,
    sortDir,
  };
}
