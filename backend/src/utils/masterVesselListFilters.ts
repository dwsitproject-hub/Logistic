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

export const MASTER_VESSEL_TYPE_OPTIONS = ['BARGE', 'TANKER', 'SPOB'] as const;
export const MASTER_VESSEL_LAMBUNG_OPTIONS = ['DHDB', 'SHSB', 'SHDB'] as const;
export const MASTER_VESSEL_TERMS_OPTIONS = ['V/C', 'T/C'] as const;

export type MasterVesselListFilterParams = {
  search?: string;
  owners?: string[];
  vesselTypes?: string[];
  heating?: string[];
  lambungTypes?: string[];
  terms?: string[];
};

export function buildMasterVesselListWhere(
  filters: MasterVesselListFilterParams,
): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  let where = 'WHERE 1=1';

  if (filters.search && filters.search.trim().length > 0) {
    params.push(`%${filters.search.trim()}%`);
    where += ` AND (
      vessel_code ILIKE $${params.length}
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
    const valueTerms = normalized.filter((t) => t === 'V/C' || t === 'T/C');
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

  return { where, params };
}

export const MASTER_VESSEL_SORT_COLUMNS: Record<string, string> = {
  vessel_code: 'vessel_code',
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
    sortKey,
    sortDir,
  };
}
