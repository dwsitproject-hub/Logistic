import { parseMultiQueryParam } from './masterVesselListFilters';
import { sqlNormalizeDischargeDestination } from './dischargeDestinationAlias';

export const CLAIM_SUSUT_BLANK = '(Blank)';

export type ClaimSusutFilterScope = 'options' | 'summary' | 'tree' | 'group' | 'rows';

export interface ClaimSusutQueryFilters {
  importId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  plants: string[];
  sources: string[];
  incoterms: string[];
  products: string[];
  groupsOfTransport: string[];
  ddProduct: string | null;
  ddPlant: string | null;
  ddIncoterm: string | null;
  ddCompany: string | null;
}

export interface ClaimSusutTreeLeaf {
  product: string;
  region_plant: string;
  incoterm: string;
  company: string;
  qty_claim: number;
  amount_after_tax_idr: number;
}

export interface ClaimSusutTreeNode {
  key: string;
  label: string;
  qtyClaim: number;
  amountAfterTax: number;
  children: ClaimSusutTreeNode[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseOptionalUuid(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || !UUID_RE.test(s)) return null;
  return s;
}

export function parseOptionalIsoDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim().slice(0, 10);
  if (!s || !ISO_DATE_RE.test(s)) return null;
  return s;
}

function firstQueryString(raw: unknown): string | null {
  if (raw == null) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const s = String(value ?? '').trim();
  return s || null;
}

export function parseClaimSusutQueryFilters(query: Record<string, unknown>): ClaimSusutQueryFilters {
  return {
    importId: parseOptionalUuid(query.importId),
    dateFrom: parseOptionalIsoDate(query.dateFrom),
    dateTo: parseOptionalIsoDate(query.dateTo),
    plants: parseMultiQueryParam(query.plant ?? query.plants),
    sources: parseMultiQueryParam(query.source ?? query.sources),
    incoterms: parseMultiQueryParam(query.incoterm ?? query.incoterms),
    products: parseMultiQueryParam(query.product ?? query.products),
    groupsOfTransport: parseMultiQueryParam(query.groupOfTransport ?? query.groupsOfTransport),
    ddProduct: firstQueryString(query.ddProduct),
    ddPlant: firstQueryString(query.ddPlant),
    ddIncoterm: firstQueryString(query.ddIncoterm),
    ddCompany: firstQueryString(query.ddCompany),
  };
}

function shouldApplyDimensionFilters(scope: ClaimSusutFilterScope): boolean {
  return scope === 'summary' || scope === 'tree' || scope === 'group' || scope === 'rows';
}

function shouldApplyDrilldown(scope: ClaimSusutFilterScope): boolean {
  return scope === 'group' || scope === 'rows';
}

function shouldApplyGroupOfTransport(scope: ClaimSusutFilterScope): boolean {
  return scope === 'rows';
}

function appendUpperInFilter(
  sqlCol: string,
  values: string[],
  params: unknown[],
): string {
  const cleaned = [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (cleaned.length === 0) return '';
  params.push(cleaned.map((v) => v.toUpperCase()));
  return ` AND UPPER(${sqlCol}) = ANY($${params.length}::text[])`;
}

function appendExactFilter(sqlCol: string, value: string | null, params: unknown[]): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  params.push(s);
  return ` AND ${sqlCol} = $${params.length}`;
}

/**
 * Shared Claim Susut universe: selected Excel import, SAP overlay for Incoterm / Region-Plant only.
 * Qty and amount stay on claim_susut_rows. Company is always Excel vendor_name.
 * Overlay never scans sap_processed_data jsonb: Incoterm from contracts, dest from
 * contract_latest_spd_snapshot.discharge_destination (typed column).
 */
export function buildClaimSusutFilteredCte(
  filters: ClaimSusutQueryFilters,
  scope: ClaimSusutFilterScope,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [filters.importId];
  const destNormalized = sqlNormalizeDischargeDestination(`NULLIF(TRIM(r.dest), '')`);

  let where = 'WHERE 1=1';
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    where += ` AND e.cr_date >= $${params.length}::date`;
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    where += ` AND e.cr_date <= $${params.length}::date`;
  }

  if (shouldApplyDimensionFilters(scope)) {
    where += appendUpperInFilter('e.region_plant', filters.plants, params);
    where += appendUpperInFilter('e.source', filters.sources, params);
    where += appendUpperInFilter('e.incoterm', filters.incoterms, params);
    where += appendUpperInFilter('e.product', filters.products, params);
  }

  if (shouldApplyDrilldown(scope)) {
    where += appendExactFilter('e.product', filters.ddProduct, params);
    where += appendExactFilter('e.region_plant', filters.ddPlant, params);
    where += appendExactFilter('e.incoterm', filters.ddIncoterm, params);
    where += appendExactFilter('e.company', filters.ddCompany, params);
  }

  if (shouldApplyGroupOfTransport(scope)) {
    where += appendUpperInFilter('e.group_of_transport_norm', filters.groupsOfTransport, params);
  }

  const sql = `
WITH active_import AS (
  SELECT id
  FROM claim_susut_imports
  WHERE ($1::uuid IS NULL OR id = $1::uuid)
  ORDER BY CASE WHEN $1::uuid IS NOT NULL THEN 0 ELSE 1 END,
           uploaded_at DESC NULLS LAST
  LIMIT 1
),
import_keys AS (
  SELECT DISTINCT
    NULLIF(TRIM(r.po_number), '') AS po_key,
    NULLIF(TRIM(r.contract_ext_no), '') AS ext_key
  FROM claim_susut_rows r
  INNER JOIN active_import ai ON ai.id = r.import_id
),
sap_by_po AS (
  SELECT DISTINCT ON (UPPER(TRIM(c.po_number)))
    TRIM(c.po_number) AS po_key,
    NULLIF(TRIM(c.incoterm), '') AS sap_incoterm,
    NULLIF(TRIM(s.discharge_destination), '') AS sap_dest
  FROM contracts c
  LEFT JOIN contract_latest_spd_snapshot s
    ON s.contract_number = c.contract_number
  WHERE NULLIF(TRIM(c.po_number), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM import_keys k
      WHERE k.po_key IS NOT NULL
        AND UPPER(TRIM(c.po_number)) = UPPER(k.po_key)
    )
  ORDER BY UPPER(TRIM(c.po_number)), c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST
),
sap_by_ext AS (
  SELECT DISTINCT ON (UPPER(TRIM(c.contract_ext_no)))
    TRIM(c.contract_ext_no) AS ext_key,
    NULLIF(TRIM(c.incoterm), '') AS sap_incoterm,
    NULLIF(TRIM(s.discharge_destination), '') AS sap_dest
  FROM contracts c
  LEFT JOIN contract_latest_spd_snapshot s
    ON s.contract_number = c.contract_number
  WHERE NULLIF(TRIM(c.contract_ext_no), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM import_keys k
      WHERE (
        (k.ext_key IS NOT NULL AND UPPER(TRIM(c.contract_ext_no)) = UPPER(k.ext_key))
        OR (k.po_key IS NOT NULL AND UPPER(TRIM(c.contract_ext_no)) = UPPER(k.po_key))
      )
    )
  ORDER BY UPPER(TRIM(c.contract_ext_no)), c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST
),
enriched AS (
  SELECT
    r.id,
    r.import_id,
    r.vendor_code,
    r.vendor_name,
    r.vendor_type,
    r.created_by,
    r.sta,
    r.crno,
    r.cr_date,
    r.os_days,
    r.group_of_transport,
    r.payment_method,
    r.dest,
    r.po_number,
    r.contract_ext_no,
    r.comm,
    r.commodity,
    r.uom,
    r.currency,
    r.company_code,
    r.remarks,
    r.type,
    r.qty_claim,
    r.amount_before_tax_idr,
    r.tax,
    r.amount_after_tax_idr,
    r.created_at,
    COALESCE(NULLIF(TRIM(r.vendor_name), ''), '${CLAIM_SUSUT_BLANK}') AS company,
    COALESCE(NULLIF(TRIM(r.commodity), ''), '${CLAIM_SUSUT_BLANK}') AS product,
    COALESCE(NULLIF(TRIM(r.vendor_type), ''), '${CLAIM_SUSUT_BLANK}') AS source,
    COALESCE(
      ${destNormalized},
      NULLIF(TRIM(COALESCE(sap_po.sap_dest, sap_po_as_ext.sap_dest, sap_ext.sap_dest)), ''),
      '${CLAIM_SUSUT_BLANK}'
    ) AS region_plant,
    COALESCE(
      NULLIF(TRIM(COALESCE(
        sap_po.sap_incoterm,
        sap_po_as_ext.sap_incoterm,
        sap_ext.sap_incoterm
      )), ''),
      '${CLAIM_SUSUT_BLANK}'
    ) AS incoterm,
    COALESCE(NULLIF(TRIM(r.group_of_transport), ''), '${CLAIM_SUSUT_BLANK}') AS group_of_transport_norm
  FROM claim_susut_rows r
  INNER JOIN active_import ai ON ai.id = r.import_id
  LEFT JOIN sap_by_po sap_po
    ON NULLIF(TRIM(r.po_number), '') IS NOT NULL
   AND UPPER(TRIM(r.po_number)) = UPPER(TRIM(sap_po.po_key))
  LEFT JOIN sap_by_ext sap_po_as_ext
    ON sap_po.po_key IS NULL
   AND NULLIF(TRIM(r.po_number), '') IS NOT NULL
   AND UPPER(TRIM(r.po_number)) = UPPER(TRIM(sap_po_as_ext.ext_key))
  LEFT JOIN sap_by_ext sap_ext
    ON sap_po.po_key IS NULL
   AND sap_po_as_ext.ext_key IS NULL
   AND NULLIF(TRIM(r.contract_ext_no), '') IS NOT NULL
   AND UPPER(TRIM(r.contract_ext_no)) = UPPER(TRIM(sap_ext.ext_key))
),
filtered AS (
  SELECT * FROM enriched e
  ${where}
)
`;

  return { sql, params };
}

export const CLAIM_SUSUT_AGING_SUM_SQL = `
  COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days >= 0 AND os_days <= 30 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_0_30,
  COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days >= 31 AND os_days <= 60 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_31_60,
  COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days >= 61 AND os_days <= 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_61_90,
  COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days > 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_gt_90,
  COALESCE(SUM(CASE
    WHEN os_days IS NOT NULL AND (
      (os_days >= 0 AND os_days <= 30)
      OR (os_days >= 31 AND os_days <= 60)
      OR (os_days >= 61 AND os_days <= 90)
      OR (os_days > 90)
    )
    THEN COALESCE(amount_after_tax_idr, 0)
    ELSE 0
  END), 0)::numeric AS grand_total
`;

export const CLAIM_SUSUT_ROW_AGING_SQL = `
  CASE WHEN os_days IS NOT NULL AND os_days >= 0 AND os_days <= 30 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_0_30,
  CASE WHEN os_days IS NOT NULL AND os_days >= 31 AND os_days <= 60 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_31_60,
  CASE WHEN os_days IS NOT NULL AND os_days >= 61 AND os_days <= 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_61_90,
  CASE WHEN os_days IS NOT NULL AND os_days > 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_gt_90
`;

function toFiniteNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sortTreeNodes(nodes: ClaimSusutTreeNode[]): ClaimSusutTreeNode[] {
  return [...nodes].sort(
    (a, b) =>
      b.amountAfterTax - a.amountAfterTax ||
      b.qtyClaim - a.qtyClaim ||
      a.label.localeCompare(b.label),
  );
}

/**
 * Nest grouped Excel rows into Product → Region/Plant → Incoterm → Company.
 */
export function nestClaimSusutTree(rows: ClaimSusutTreeLeaf[]): ClaimSusutTreeNode[] {
  type Acc = { qty: number; amount: number; children: Map<string, Acc> };

  const root = new Map<string, Acc>();

  const touch = (map: Map<string, Acc>, key: string): Acc => {
    let acc = map.get(key);
    if (!acc) {
      acc = { qty: 0, amount: 0, children: new Map() };
      map.set(key, acc);
    }
    return acc;
  };

  for (const row of rows) {
    const product = String(row.product ?? '').trim() || CLAIM_SUSUT_BLANK;
    const plant = String(row.region_plant ?? '').trim() || CLAIM_SUSUT_BLANK;
    const incoterm = String(row.incoterm ?? '').trim() || CLAIM_SUSUT_BLANK;
    const company = String(row.company ?? '').trim() || CLAIM_SUSUT_BLANK;
    const qty = toFiniteNumber(row.qty_claim);
    const amount = toFiniteNumber(row.amount_after_tax_idr);

    const p = touch(root, product);
    p.qty += qty;
    p.amount += amount;
    const pl = touch(p.children, plant);
    pl.qty += qty;
    pl.amount += amount;
    const inc = touch(pl.children, incoterm);
    inc.qty += qty;
    inc.amount += amount;
    const co = touch(inc.children, company);
    co.qty += qty;
    co.amount += amount;
  }

  const toNodes = (map: Map<string, Acc>): ClaimSusutTreeNode[] =>
    sortTreeNodes(
      [...map.entries()].map(([key, acc]) => ({
        key,
        label: key,
        qtyClaim: acc.qty,
        amountAfterTax: acc.amount,
        children: toNodes(acc.children),
      })),
    );

  return toNodes(root);
}

export interface ClaimSusutStoredError {
  rowIndex: number;
  message: string;
}

export function parseClaimSusutStoredErrors(errors: unknown): ClaimSusutStoredError[] {
  if (!Array.isArray(errors)) return [];
  return errors.map((entry) => {
    if (entry && typeof entry === 'object') {
      const o = entry as { rowIndex?: unknown; message?: unknown };
      return {
        rowIndex: Number(o.rowIndex) || 0,
        message: String(o.message ?? '').trim() || 'Unknown error',
      };
    }
    return { rowIndex: 0, message: String(entry ?? '').trim() || 'Unknown error' };
  });
}
