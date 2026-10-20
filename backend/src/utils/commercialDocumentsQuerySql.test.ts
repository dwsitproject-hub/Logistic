import { describe, expect, it } from 'vitest';
import {
  buildCommercialDocumentsBaseCte,
  buildCommercialDocumentsCompletenessByPlantQuery,
  buildCommercialDocumentsListQuery,
  buildCommercialDocumentsSummaryQuery,
  commercialCompletenessPct,
  COMMERCIAL_DOCUMENT_SLOT_COUNT,
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
    expect(cte).toContain('AS doc_berita_acara');
    expect(cte).toContain('AS doc_bea_cukai');
    expect(cte).toContain('AS doc_delivery_order');
  });
});

describe('commercialDocumentsQuerySql SAP OA amounts', () => {
  const cte = buildCommercialDocumentsBaseCte();

  it('selects the four OA amounts from the latest SAP row', () => {
    for (const col of ['vessel_oa_budget', 'vessel_oa_actual', 'truck_oa_budget', 'truck_oa_actual']) {
      expect(cte).toContain(`AS ${col},`);
    }
    expect(cte).toContain("latest_spd.data->'raw'->>'Vessel OA Budget'");
    expect(cte).toContain("latest_spd.data->'raw'->>'Vessel OA Actual'");
    expect(cte).toContain("latest_spd.data->'raw'->>'Trucking OA Budget'");
    expect(cte).toContain("latest_spd.data->'raw'->>'Trucking OA Actual'");
  });

  it('reads Trucking OA before the Truck OA spelling, and turns text that is not a number into NULL instead of failing', () => {
    expect(cte.indexOf("->>'Trucking OA Budget'")).toBeLessThan(cte.indexOf("->>'Truck OA Budget'"));
    expect(cte).toContain("~ '^-?[0-9]+(\\.[0-9]+)?$' THEN");
  });

  it('can be sorted by each of them', () => {
    for (const key of ['vessel_oa_budget', 'vessel_oa_actual', 'truck_oa_budget', 'truck_oa_actual']) {
      const { sql } = buildCommercialDocumentsListQuery({ page: 1, limit: 10, sortKey: key, sortDir: 'asc' });
      expect(sql).toContain(`ORDER BY e.${key} ASC NULLS LAST`);
    }
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
      'berita_acara',
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

describe('commercialDocuments completeness by plant', () => {
  it('counts uploaded checklist slots against contracts times nine document types', () => {
    expect(COMMERCIAL_DOCUMENT_SLOT_COUNT).toBe(9);
    const { sql, values } = buildCommercialDocumentsCompletenessByPlantQuery({
      dateFrom: '2026-01-01',
      dateTo: '2026-10-20',
    });
    expect(sql).toContain("(COUNT(*) * 9)::int AS total_slots");
    expect(sql).toContain('AS uploaded_slots');
    expect(sql).toContain("THEN 'Unassigned'");
    expect(sql).toContain('CASE WHEN e.doc_draft_contract THEN 1 ELSE 0 END');
    expect(sql).toContain('CASE WHEN e.doc_invoice_fp_full THEN 1 ELSE 0 END');
    expect(sql).toContain('e.contract_date >= $1::date');
    expect(sql).toContain('e.contract_date <= $2::date');
    expect(sql).not.toContain('e.doc_contract = true');
    expect(values).toEqual(['2026-01-01', '2026-10-20']);
    expect(sql).toMatch(/END ASC/);
  });

  it('applies the Region/Plant filter without a document-type filter', () => {
    const { sql, values } = buildCommercialDocumentsCompletenessByPlantQuery({
      dateFrom: '2026-01-01',
      dateTo: '2026-10-20',
      plant: ['BONTANG', 'Blank'],
    });
    expect(sql).toContain("UPPER(NULLIF(TRIM(e.plant_site), 'Blank'))");
    expect(values).toContain('BONTANG');
    expect(values).not.toContain('Blank');
    expect(sql).not.toContain('e.doc_contract = true');
  });

  it('reports completeness as one decimal percent', () => {
    expect(commercialCompletenessPct(1, 9)).toBe(11.1);
    expect(commercialCompletenessPct(9, 9)).toBe(100);
    expect(commercialCompletenessPct(0, 0)).toBe(0);
  });
});
