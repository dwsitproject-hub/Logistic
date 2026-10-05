import { describe, expect, it } from 'vitest';
import {
  buildCommercialDocumentsBaseCte,
  buildCommercialDocumentsListQuery,
  buildCommercialDocumentsSummaryQuery,
} from './commercialDocumentsQuerySql';

describe('commercialDocumentsQuerySql Region/Site', () => {
  it('plant_site uses Discharge Destination with B2B overlay, not master_plants.group_plant', () => {
    const cte = buildCommercialDocumentsBaseCte();
    expect(cte).toContain('discharge_destination');
    expect(cte).toContain('b2b_ending_child_snapshot');
    expect(cte).not.toContain('master_plants');
    expect(cte).not.toContain('group_plant');
  });

  it('filters plant= by destinasi case-insensitively and ignores Blank', () => {
    const { sql, values } = buildCommercialDocumentsListQuery({
      plant: ['BONTANG', 'Blank'],
      page: 1,
      limit: 50,
    });
    expect(sql).toContain("UPPER(NULLIF(TRIM(e.plant_site), 'Blank'))");
    expect(values).toContain('BONTANG');
    expect(values).not.toContain('Blank');
  });

  it('empty plant filter does not restrict destinasi (including Blank rows)', () => {
    const { sql } = buildCommercialDocumentsListQuery({ page: 1, limit: 50 });
    expect(sql).not.toContain('UPPER(NULLIF(TRIM(e.plant_site)');
  });

  it('orders by requested column then stable tie-breakers (all pages)', () => {
    const { sql } = buildCommercialDocumentsListQuery({
      page: 1,
      limit: 50,
      sortKey: 'po_number',
      sortDir: 'asc',
    });
    expect(sql).toContain('ORDER BY e.po_number ASC NULLS LAST, e.contract_ext_no ASC, e.contract_id ASC');
    expect(sql).not.toContain('ORDER BY e.contract_date DESC NULLS LAST, e.contract_ext_no ASC, e.contract_id ASC');
  });

  it('defaults ORDER BY contract_date DESC when sortKey is missing', () => {
    const { sql } = buildCommercialDocumentsListQuery({ page: 1, limit: 50 });
    expect(sql).toContain('ORDER BY e.contract_date DESC NULLS LAST');
  });

  it('selects payoff_date from SAP / MV / payments and new doc flags', () => {
    const cte = buildCommercialDocumentsBaseCte();
    expect(cte).toContain("->>'payoff_date'");
    expect(cte).toContain("'Payoff Date'");
    expect(cte).toContain('pay.payoff_date');
    expect(cte).toContain('AS payoff_date');
    expect(cte).toContain('AS doc_draft_contract');
    expect(cte).toContain('AS doc_bea_cukai');
    expect(cte).toContain('AS doc_delivery_order');
  });
});

describe('commercialDocumentsQuerySql summary cards', () => {
  const scope = { dateFrom: '2026-01-01', dateTo: '2026-10-05', product: 'CPO', plant: ['BONTANG'] };

  it('counts every document type in one pass over all contracts in scope (not only open)', () => {
    const { sql } = buildCommercialDocumentsSummaryQuery(scope);
    expect(sql).toContain('COUNT(*)::int AS total_contract_count');
    for (const key of [
      'draft_contract',
      'contract',
      'addendum_contract',
      'bea_cukai',
      'delivery_order',
      'invoice_fp_dp',
      'invoice_fp_payoff',
      'invoice_fp_full',
    ]) {
      expect(sql).toContain(`FILTER (WHERE e.doc_${key})::int AS uploaded_${key}`);
    }
    expect(sql).not.toContain('is_open = true');
  });

  it('uses the same scope filters and bind values as the table, so a card number equals its table total', () => {
    const summary = buildCommercialDocumentsSummaryQuery(scope);
    const list = buildCommercialDocumentsListQuery({ ...scope, page: 1, limit: 50 });
    expect(summary.values).toEqual(list.values.slice(0, list.values.length - 2));
  });

  it('table click-through (document type + status) filters on the flag without forcing open', () => {
    const { sql } = buildCommercialDocumentsListQuery({
      documentType: 'contract',
      documentStatus: 'checked',
      page: 1,
      limit: 50,
    });
    expect(sql).toContain('e.doc_contract = true');
    expect(sql).not.toContain('e.is_open = true');
  });
});
