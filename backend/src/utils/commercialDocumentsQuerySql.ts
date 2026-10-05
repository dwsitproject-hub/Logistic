import { documentTypesForCategory } from './commercialDocumentsConstants';
import { sqlB2bOriginEndingChildLateralJoin } from './b2bOriginEndingSql';
import { appendRegionSiteFilter, sqlRegionSiteDisplayFromJsonAndB2b } from './regionSiteSql';
import { resolveCommercialDocumentsListSort } from './commercialDocumentsListSort';

/** Open contract status for summary card counts. */
export const COMMERCIAL_DOCS_OPEN_STATUS_SQL = `(
  UPPER(TRIM(COALESCE(latest_spd.data->'contract'->>'status', c.status, ''))) IN ('OPEN', 'ACTIVE')
  OR (
    latest_spd.data IS NULL
    AND UPPER(TRIM(COALESCE(c.status, ''))) IN ('OPEN', 'ACTIVE')
  )
)`;

export type CommercialDocumentsListParams = {
  dateFrom?: string | null;
  dateTo?: string | null;
  search?: string | null;
  documentType?: string | null;
  documentStatus?: 'checked' | 'unchecked' | null;
  incoterm?: string | null;
  product?: string | null;
  supplier?: string | null;
  plant?: string | string[] | null;
  page?: number;
  limit?: number;
  sortKey?: string | null;
  sortDir?: string | null;
};

function parseSapPaymentDateFromTrimmedExpr(trimmedExpr: string): string {
  return `(CASE
    WHEN ${trimmedExpr} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN ${trimmedExpr}::date
    WHEN ${trimmedExpr} ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(${trimmedExpr}, 'MM/DD/YY')
    WHEN ${trimmedExpr} ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(${trimmedExpr}, 'MM/DD/YYYY')
    ELSE NULL
  END)`;
}

function sapPaymentRawExpr(jsonPaths: string[]): string {
  return `trim(COALESCE(${jsonPaths.join(', ')}))`;
}

function sqlDocFlag(columnTypes: string[]): string {
  const list = columnTypes.map((t) => `'${t}'`).join(', ');
  return `BOOL_OR(document_type IN (${list}))`;
}

export function buildCommercialDocumentsBaseCte(): string {
  const paymentDueRaw = sapPaymentRawExpr([
    `NULLIF(trim(latest_spd.data->'payment'->>'due_date_payment'), '')`,
    `NULLIF(trim(latest_spd.data->'raw'->>'Due Date Payment'), '')`,
    `NULLIF(trim(latest_spd.data->>'due date payment'), '')`,
    `NULLIF(trim(latest_spd.data->>'Due Date Payment'), '')`,
  ]);
  const dpDueRaw = sapPaymentRawExpr([
    `NULLIF(trim(latest_spd.data->'payment'->>'dp_date'), '')`,
    `NULLIF(trim(latest_spd.data->'raw'->>'DP Date'), '')`,
    `NULLIF(trim(latest_spd.data->>'dp date'), '')`,
    `NULLIF(trim(latest_spd.data->>'DP Date'), '')`,
  ]);
  const payoffRaw = sapPaymentRawExpr([
    `NULLIF(trim(latest_spd.data->'payment'->>'payoff_date'), '')`,
    `NULLIF(trim(latest_spd.data->'raw'->>'Payoff Date'), '')`,
    `NULLIF(trim(latest_spd.data->>'payoff date'), '')`,
    `NULLIF(trim(latest_spd.data->>'Payoff Date'), '')`,
  ]);

  return `
    WITH latest_spd AS (
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        spd.data,
        spd.created_at
      FROM sap_processed_data spd
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
    ),
    contract_rows AS (
      SELECT
        c.id,
        c.contract_id,
        COALESCE(
          NULLIF(TRIM(latest_spd.data->'raw'->>'Contract Ext No'), ''),
          NULLIF(TRIM(latest_spd.data->>'Contract Ext No'), ''),
          c.contract_id
        ) AS contract_ext_no,
        c.po_number,
        c.buyer,
        c.supplier,
        c.product,
        c.incoterm,
        c.contract_date,
        c.quantity_ordered,
        c.unit_price,
        c.currency,
        c.status,
        c.transport_mode,
        COALESCE(NULLIF(TRIM(c.company_name), ''), latest_spd.data->'raw'->>'Buyer', latest_spd.data->>'Buyer') AS company_name,
        ${sqlRegionSiteDisplayFromJsonAndB2b('latest_spd.data')} AS plant_site,
        COALESCE(latest_spd.data->'contract'->>'contract_type', latest_spd.data->>'B2B Flag') AS b2b_flag,
        COALESCE(
          latest_spd.data->'contract'->>'contract_reference_po',
          latest_spd.data->>'CONTRACT REFF PO',
          latest_spd.data->>'Contract Reff PO Ini',
          latest_spd.data->'raw'->>'Contract Reff PO Ini'
        ) AS contract_reference_po,
        latest_spd.data->'contract'->>'status' AS import_status,
        COALESCE(
          ${parseSapPaymentDateFromTrimmedExpr(paymentDueRaw)},
          mv_pay.due_date_payment,
          pay.payment_due_date
        ) AS payment_due_date,
        COALESCE(
          ${parseSapPaymentDateFromTrimmedExpr(dpDueRaw)},
          mv_pay.dp_date
        ) AS dp_due_date,
        COALESCE(
          ${parseSapPaymentDateFromTrimmedExpr(payoffRaw)},
          mv_pay.payoff_date,
          pay.payoff_date
        ) AS payoff_date,
        latest_spd.data AS latest_spd_data,
        ${COMMERCIAL_DOCS_OPEN_STATUS_SQL} AS is_open
      FROM contracts c
      LEFT JOIN latest_spd ON latest_spd.contract_number = c.contract_id
      ${sqlB2bOriginEndingChildLateralJoin({ originPoExpr: 'c.po_number' })}
      LEFT JOIN mv_contract_payment_dates mv_pay ON mv_pay.contract_id = c.contract_id
      LEFT JOIN LATERAL (
        SELECT p.payment_due_date, p.payoff_date
        FROM payments p
        WHERE p.contract_id = c.id
        ORDER BY p.created_at DESC NULLS LAST
        LIMIT 1
      ) pay ON true
      WHERE COALESCE(
        NULLIF(TRIM(latest_spd.data->'raw'->>'Contract Ext No'), ''),
        NULLIF(TRIM(latest_spd.data->>'Contract Ext No'), ''),
        c.contract_id
      ) IS NOT NULL
    ),
    doc_flags AS (
      SELECT
        NULLIF(TRIM(po_number), '') AS po_number,
        ${sqlDocFlag(documentTypesForCategory('draft_contract'))} AS doc_draft_contract,
        ${sqlDocFlag(documentTypesForCategory('contract'))} AS doc_contract,
        ${sqlDocFlag(documentTypesForCategory('addendum_contract'))} AS doc_addendum_contract,
        ${sqlDocFlag(documentTypesForCategory('bea_cukai'))} AS doc_bea_cukai,
        ${sqlDocFlag(documentTypesForCategory('delivery_order'))} AS doc_delivery_order,
        ${sqlDocFlag(documentTypesForCategory('invoice_fp_dp'))} AS doc_invoice_fp_dp,
        ${sqlDocFlag(documentTypesForCategory('invoice_fp_payoff'))} AS doc_invoice_fp_payoff,
        ${sqlDocFlag(documentTypesForCategory('invoice_fp_full'))} AS doc_invoice_fp_full,
        COUNT(*)::int AS uploaded_count
      FROM commercial_document_files
      WHERE NULLIF(TRIM(po_number), '') IS NOT NULL
      GROUP BY NULLIF(TRIM(po_number), '')
    ),
    legacy_doc_flags AS (
      SELECT
        contract_ext_no,
        ${sqlDocFlag(documentTypesForCategory('draft_contract'))} AS doc_draft_contract,
        ${sqlDocFlag(documentTypesForCategory('contract'))} AS doc_contract,
        ${sqlDocFlag(documentTypesForCategory('addendum_contract'))} AS doc_addendum_contract,
        ${sqlDocFlag(documentTypesForCategory('bea_cukai'))} AS doc_bea_cukai,
        ${sqlDocFlag(documentTypesForCategory('delivery_order'))} AS doc_delivery_order,
        ${sqlDocFlag(documentTypesForCategory('invoice_fp_dp'))} AS doc_invoice_fp_dp,
        ${sqlDocFlag(documentTypesForCategory('invoice_fp_payoff'))} AS doc_invoice_fp_payoff,
        ${sqlDocFlag(documentTypesForCategory('invoice_fp_full'))} AS doc_invoice_fp_full,
        COUNT(*)::int AS uploaded_count
      FROM commercial_document_files
      WHERE NULLIF(TRIM(po_number), '') IS NULL
      GROUP BY contract_ext_no
    ),
    enriched AS (
      SELECT
        cr.*,
        COALESCE(df.doc_draft_contract, ldf.doc_draft_contract, false) AS doc_draft_contract,
        COALESCE(df.doc_contract, ldf.doc_contract, false) AS doc_contract,
        COALESCE(df.doc_addendum_contract, ldf.doc_addendum_contract, false) AS doc_addendum_contract,
        COALESCE(df.doc_bea_cukai, ldf.doc_bea_cukai, false) AS doc_bea_cukai,
        COALESCE(df.doc_delivery_order, ldf.doc_delivery_order, false) AS doc_delivery_order,
        COALESCE(df.doc_invoice_fp_dp, ldf.doc_invoice_fp_dp, false) AS doc_invoice_fp_dp,
        COALESCE(df.doc_invoice_fp_payoff, ldf.doc_invoice_fp_payoff, false) AS doc_invoice_fp_payoff,
        COALESCE(df.doc_invoice_fp_full, ldf.doc_invoice_fp_full, false) AS doc_invoice_fp_full,
        COALESCE(df.uploaded_count, ldf.uploaded_count, 0) AS uploaded_count
      FROM contract_rows cr
      LEFT JOIN doc_flags df ON df.po_number = NULLIF(TRIM(cr.po_number), '')
      LEFT JOIN legacy_doc_flags ldf
        ON ldf.contract_ext_no = cr.contract_ext_no
       AND df.po_number IS NULL
    )
  `;
}

function docTypeCheckedColumn(documentType: string): string | null {
  const map: Record<string, string> = {
    draft_contract: 'doc_draft_contract',
    contract: 'doc_contract',
    addendum_contract: 'doc_addendum_contract',
    bea_cukai: 'doc_bea_cukai',
    delivery_order: 'doc_delivery_order',
    invoice_fp_dp: 'doc_invoice_fp_dp',
    invoice_fp_payoff: 'doc_invoice_fp_payoff',
    invoice_fp_full: 'doc_invoice_fp_full',
  };
  return map[documentType] ?? null;
}

/**
 * The WHERE conditions shared by the contract table and the summary cards, so a card's number is the
 * number of rows the table shows after that card is clicked. Document type/status are NOT here: the
 * cards count every type at once, the table narrows to one.
 */
export type CommercialDocumentsScopeParams = Pick<
  CommercialDocumentsListParams,
  'dateFrom' | 'dateTo' | 'search' | 'incoterm' | 'product' | 'supplier' | 'plant'
>;

function buildScopeWhere(params: CommercialDocumentsScopeParams): { where: string[]; values: unknown[]; nextIndex: number } {
  const values: unknown[] = [];
  let idx = 1;
  const where: string[] = ['1=1'];

  if (params.dateFrom) {
    where.push(`e.contract_date >= $${idx++}::date`);
    values.push(params.dateFrom);
  }
  if (params.dateTo) {
    where.push(`e.contract_date <= $${idx++}::date`);
    values.push(params.dateTo);
  }
  if (params.search?.trim()) {
    const term = `%${params.search.trim()}%`;
    where.push(`(
      e.contract_ext_no ILIKE $${idx}
      OR COALESCE(e.po_number, '') ILIKE $${idx}
      OR COALESCE(e.supplier, '') ILIKE $${idx}
    )`);
    values.push(term);
    idx++;
  }
  if (params.incoterm?.trim()) {
    where.push(`UPPER(TRIM(COALESCE(e.incoterm, ''))) = UPPER($${idx++})`);
    values.push(params.incoterm.trim());
  }
  if (params.product?.trim()) {
    where.push(`TRIM(COALESCE(e.product, '')) = $${idx++}`);
    values.push(params.product.trim());
  }
  if (params.supplier?.trim()) {
    where.push(`TRIM(COALESCE(e.supplier, '')) = $${idx++}`);
    values.push(params.supplier.trim());
  }
  const plants = (Array.isArray(params.plant) ? params.plant : params.plant ? [params.plant] : [])
    .map((p) => String(p).trim())
    .filter(Boolean);
  const regionSiteFilter = appendRegionSiteFilter(plants, idx, 'e.plant_site');
  if (regionSiteFilter.sql) {
    where.push(regionSiteFilter.sql.replace(/^ AND /, ''));
    values.push(...regionSiteFilter.params);
    idx = regionSiteFilter.nextIndex;
  }
  return { where, values, nextIndex: idx };
}

export function buildCommercialDocumentsListQuery(params: CommercialDocumentsListParams): {
  sql: string;
  countSql: string;
  values: unknown[];
} {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(params.limit) || 50));
  const offset = (page - 1) * limit;

  const scope = buildScopeWhere(params);
  const values = scope.values;
  const where = scope.where;
  let idx = scope.nextIndex;
  if (params.documentType && params.documentStatus) {
    const col = docTypeCheckedColumn(params.documentType);
    if (col) {
      where.push(params.documentStatus === 'checked' ? `e.${col} = true` : `e.${col} = false`);
    }
  }

  const whereSql = where.join(' AND ');
  const base = buildCommercialDocumentsBaseCte();

  const countSql = `
    ${base}
    SELECT COUNT(*)::int AS total FROM enriched e WHERE ${whereSql}
  `;

  const listSort = resolveCommercialDocumentsListSort(params.sortKey, params.sortDir);
  const dirSql = listSort.sortDir === 'asc' ? 'ASC' : 'DESC';
  const sql = `
    ${base}
    SELECT e.* FROM enriched e
    WHERE ${whereSql}
    ORDER BY ${listSort.orderExpr} ${dirSql} NULLS LAST, e.contract_ext_no ASC, e.contract_id ASC
    LIMIT $${idx++} OFFSET $${idx++}
  `;
  values.push(limit, offset);

  return { sql, countSql, values };
}

export function buildCommercialDocumentsSummaryQuery(params: CommercialDocumentsScopeParams): {
  sql: string;
  values: unknown[];
} {
  const scope = buildScopeWhere(params);
  const count = (flag: string) => `COUNT(*) FILTER (WHERE e.${flag})::int`;
  const sql = `
    ${buildCommercialDocumentsBaseCte()}
    SELECT
      COUNT(*)::int AS total_contract_count,
      ${count('doc_draft_contract')} AS uploaded_draft_contract,
      ${count('doc_contract')} AS uploaded_contract,
      ${count('doc_addendum_contract')} AS uploaded_addendum_contract,
      ${count('doc_bea_cukai')} AS uploaded_bea_cukai,
      ${count('doc_delivery_order')} AS uploaded_delivery_order,
      ${count('doc_invoice_fp_dp')} AS uploaded_invoice_fp_dp,
      ${count('doc_invoice_fp_payoff')} AS uploaded_invoice_fp_payoff,
      ${count('doc_invoice_fp_full')} AS uploaded_invoice_fp_full
    FROM enriched e
    WHERE ${scope.where.join(' AND ')}
  `;
  return { sql, values: scope.values };
}
