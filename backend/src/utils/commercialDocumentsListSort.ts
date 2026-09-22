/**
 * GET /commercial-documents list sort.
 * Static expressions only — never interpolate the request sortKey into SQL.
 */

export type CommercialDocsSortDir = 'asc' | 'desc';

export interface CommercialDocumentsListSortResolution {
  sortKey: string;
  orderExpr: string;
  sortDir: CommercialDocsSortDir;
}

/** Keys match frontend CommercialDocsColumnId. Expressions are on alias `e`. */
export const COMMERCIAL_DOCS_SQL_SORT_COLUMNS: Record<string, string> = {
  contract_date: 'e.contract_date',
  contract_ext_no: 'e.contract_ext_no',
  po_number: 'e.po_number',
  supplier: 'e.supplier',
  incoterm: 'e.incoterm',
  product: 'e.product',
  payment_due_date: 'e.payment_due_date',
  dp_due_date: 'e.dp_due_date',
  payoff_date: 'e.payoff_date',
  contract_qty: 'e.quantity_ordered',
  unit_price: 'e.unit_price',
  total_price: '(COALESCE(e.quantity_ordered, 0) * COALESCE(e.unit_price, 0))',
  buyer: 'e.buyer',
  plant_site: 'e.plant_site',
  transport_mode: 'e.transport_mode',
  b2b_flag: 'e.b2b_flag',
  doc_draft_contract: 'e.doc_draft_contract',
  doc_contract: 'e.doc_contract',
  doc_addendum_contract: 'e.doc_addendum_contract',
  doc_bea_cukai: 'e.doc_bea_cukai',
  doc_delivery_order: 'e.doc_delivery_order',
  doc_invoice_fp_dp: 'e.doc_invoice_fp_dp',
  doc_invoice_fp_payoff: 'e.doc_invoice_fp_payoff',
  doc_invoice_fp_full: 'e.doc_invoice_fp_full',
};

export function resolveCommercialDocumentsListSort(
  sortKeyRaw: unknown,
  sortDirRaw: unknown,
): CommercialDocumentsListSortResolution {
  const key = typeof sortKeyRaw === 'string' ? sortKeyRaw.trim() : '';
  const sortDir: CommercialDocsSortDir = String(sortDirRaw || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
  if (COMMERCIAL_DOCS_SQL_SORT_COLUMNS[key]) {
    return { sortKey: key, orderExpr: COMMERCIAL_DOCS_SQL_SORT_COLUMNS[key], sortDir };
  }
  return {
    sortKey: 'contract_date',
    orderExpr: COMMERCIAL_DOCS_SQL_SORT_COLUMNS.contract_date,
    sortDir,
  };
}
