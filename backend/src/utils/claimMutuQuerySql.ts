/**
 * Claim Mutu query building: one filter definition shared by every endpoint.
 *
 * `b2b` defaults to 'exclude' - the scope of the claim team's Pivot, Summary Per Komoditi and Rekap
 * Per Lokasi. 'include' is the scope of their Summary Per Unit trend.
 *
 * GROUP and METODE PAYMENT exist on the OS sheet only; the Real sheet has neither column, so those
 * two filters narrow the outstanding side and leave the realised side whole. The page says so.
 */

export const CLAIM_MUTU_BLANK = '(Blank)';

export type ClaimMutuB2bScope = 'exclude' | 'include';

export interface ClaimMutuFilters {
  importId: string | null;
  b2b: ClaimMutuB2bScope;
  dateFrom: string | null;
  dateTo: string | null;
  commodities: string[];
  units: string[];
  vendorTypes: string[];
  claimGroups: string[];
  metodePayments: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function list(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : String(raw).split(',');
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
}

export function parseClaimMutuFilters(q: Record<string, unknown>): ClaimMutuFilters {
  const importId = String(q.importId ?? '').trim();
  const dateFrom = String(q.dateFrom ?? '').trim();
  const dateTo = String(q.dateTo ?? '').trim();
  return {
    importId: UUID_RE.test(importId) ? importId : null,
    b2b: String(q.b2b ?? '').trim().toLowerCase() === 'include' ? 'include' : 'exclude',
    dateFrom: ISO_DATE_RE.test(dateFrom) ? dateFrom : null,
    dateTo: ISO_DATE_RE.test(dateTo) ? dateTo : null,
    commodities: list(q.commodities),
    units: list(q.units),
    vendorTypes: list(q.vendorTypes),
    claimGroups: list(q.claimGroups),
    metodePayments: list(q.metodePayments),
  };
}

/** Blank-safe grouping value, matching what the filter options offer. */
export const blankOr = (expr: string) => `COALESCE(NULLIF(TRIM(${expr}), ''), '${CLAIM_MUTU_BLANK}')`;

/** Aging buckets exactly as the workbook's VLOOKUP: 0-30, 31-60, 61-90, and 91 upward. */
export const CLAIM_MUTU_AGING_SQL = `
  COALESCE(SUM(CASE WHEN os_days <= 30 THEN amount END), 0)::float8 AS a_0_30,
  COALESCE(SUM(CASE WHEN os_days BETWEEN 31 AND 60 THEN amount END), 0)::float8 AS a_31_60,
  COALESCE(SUM(CASE WHEN os_days BETWEEN 61 AND 90 THEN amount END), 0)::float8 AS a_61_90,
  COALESCE(SUM(CASE WHEN os_days > 90 THEN amount END), 0)::float8 AS a_gt_90,
  COALESCE(SUM(amount), 0)::float8 AS grand_total`;

type Side = 'os' | 'real';

/**
 * `WITH active_import AS (...), <side> AS (...)` for one side, with its parameters.
 *
 * "Active" is the requested import, else the latest - the same rule Claim Susut uses. `omit`
 * drops one filter, for a filter's own option list.
 */
export function buildClaimMutuSideCte(
  side: Side,
  f: ClaimMutuFilters,
  opts: {
    omit?: keyof ClaimMutuFilters;
    params?: unknown[];
    name?: string;
    /**
     * 'active' (default): the one active import. 'monthly': the latest import of every month that
     * has a period - the Summary Per Unit trend, one point per month. Monthly ignores importId and
     * the date filter, which would otherwise cut the trend down to the months it happens to cover.
     */
    scope?: 'active' | 'monthly';
  } = {},
): { sql: string; params: unknown[] } {
  const params: unknown[] = opts.params ? [...opts.params] : [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const monthly = opts.scope === 'monthly';
  const importParam = monthly ? '' : p(f.importId);
  const table = side === 'os' ? 'claim_mutu_rows' : 'claim_mutu_real_rows';
  const dateCol = side === 'os' ? 'r.cr_date' : 'r.claim_date';
  const qty = side === 'os' ? 'r.qty_claim_kg' : 'r.qty_kg';
  const commodity = side === 'os' ? 'r.product' : 'r.commodity';
  const where: string[] = [];
  if (f.b2b === 'exclude') where.push('NOT r.is_b2b');
  if (!monthly && f.dateFrom && opts.omit !== 'dateFrom') where.push(`(${dateCol} IS NULL OR ${dateCol} >= ${p(f.dateFrom)}::date)`);
  if (!monthly && f.dateTo && opts.omit !== 'dateTo') where.push(`(${dateCol} IS NULL OR ${dateCol} <= ${p(f.dateTo)}::date)`);
  const inList = (key: keyof ClaimMutuFilters, expr: string) => {
    const values = f[key] as string[];
    if (opts.omit === key || values.length === 0) return;
    where.push(`UPPER(${blankOr(expr)}) = ANY(${p(values.map((v) => v.toUpperCase()))}::text[])`);
  };
  inList('commodities', commodity);
  inList('units', 'r.unit');
  inList('vendorTypes', 'r.vendor_type');
  if (side === 'os') {
    inList('claimGroups', 'r.claim_group');
    inList('metodePayments', 'r.metode_payment');
  }
  const name = opts.name ?? side;
  const importCte = monthly
    ? `
active_import AS (
  SELECT DISTINCT ON (period_month) id, period_month
  FROM claim_mutu_imports
  WHERE period_month IS NOT NULL
  ORDER BY period_month, uploaded_at DESC NULLS LAST
)`
    : `
active_import AS (
  SELECT id, period_month FROM claim_mutu_imports
  WHERE (${importParam}::uuid IS NULL OR id = ${importParam}::uuid)
  ORDER BY CASE WHEN ${importParam}::uuid IS NOT NULL THEN 0 ELSE 1 END, uploaded_at DESC NULLS LAST
  LIMIT 1
)`;
  // Realised claims (outside the monthly trend) are read across EVERY import, like Shortage Claim:
  // each monthly file carries only that month's approvals, so a YTD figure needs every month's
  // Real_Claim. A row uploaded twice (the same month re-imported) counts once, from the latest
  // upload that has it - matched on the key the B2B marking uses. The CR date filter above
  // (claim_date) then cuts them to the page's range.
  if (side === 'real' && !monthly) {
    where.unshift('r.uploaded_at IS NOT DISTINCT FROM r.latest');
    const sql = `${importCte},
${name}_all AS (
  SELECT x.*, i.period_month, i.uploaded_at,
         MAX(i.uploaded_at) OVER (PARTITION BY x.cr_no, x.cm_no, x.po_number, x.amount_after_tax_idr) AS latest
  FROM ${table} x
  JOIN claim_mutu_imports i ON i.id = x.import_id
),
${name} AS (
  SELECT r.*,
         ${blankOr(commodity)} AS commodity_norm,
         ${blankOr('r.unit')} AS unit_norm,
         ${blankOr('r.dest')} AS dest_norm,
         COALESCE(${qty}, 0)::numeric AS qty,
         COALESCE(r.amount_after_tax_idr, 0)::numeric AS amount
  FROM ${name}_all r
  WHERE ${where.join(' AND ')}
)`;
    return { sql, params };
  }
  const sql = `${importCte},
${name} AS (
  SELECT r.*,
         ai.period_month,
         ${blankOr(commodity)} AS commodity_norm,
         ${blankOr('r.unit')} AS unit_norm,
         ${blankOr('r.dest')} AS dest_norm,
         COALESCE(${qty}, 0)::numeric AS qty,
         COALESCE(r.amount_after_tax_idr, 0)::numeric AS amount
  FROM ${table} r
  JOIN active_import ai ON ai.id = r.import_id
  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
)`;
  return { sql, params };
}
