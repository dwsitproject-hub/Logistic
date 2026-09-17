import { describe, expect, it } from 'vitest';
import {
  buildClaimSusutFilteredCte,
  nestClaimSusutTree,
  parseClaimSusutQueryFilters,
  parseOptionalIsoDate,
  parseOptionalUuid,
  parseClaimSusutStoredErrors,
  CLAIM_SUSUT_BLANK,
} from './claimSusutQuerySql';

describe('parseClaimSusutQueryFilters', () => {
  it('parses comma and repeated filter values plus drilldown keys', () => {
    const filters = parseClaimSusutQueryFilters({
      importId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-28',
      plant: 'BONTANG,KIJING',
      source: ['MILL', 'TRADER'],
      incoterm: 'FOB',
      product: 'CPO',
      groupOfTransport: 'TRUCK',
      ddProduct: 'CPO',
      ddPlant: 'BONTANG',
      ddIncoterm: 'FOB',
      ddCompany: 'PT Example',
    });
    expect(filters.importId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(filters.dateFrom).toBe('2026-01-01');
    expect(filters.plants).toEqual(['BONTANG', 'KIJING']);
    expect(filters.sources).toEqual(['MILL', 'TRADER']);
    expect(filters.ddCompany).toBe('PT Example');
  });

  it('rejects invalid import ids and dates', () => {
    expect(parseOptionalUuid('not-a-uuid')).toBeNull();
    expect(parseOptionalIsoDate('01/02/2026')).toBeNull();
    expect(parseOptionalIsoDate('2026-09-09')).toBe('2026-09-09');
  });
});

describe('parseClaimSusutStoredErrors', () => {
  it('normalizes json error objects and strings', () => {
    expect(
      parseClaimSusutStoredErrors([
        { rowIndex: 12, message: 'Missing PO' },
        'bare string',
      ]),
    ).toEqual([
      { rowIndex: 12, message: 'Missing PO' },
      { rowIndex: 0, message: 'bare string' },
    ]);
    expect(parseClaimSusutStoredErrors(null)).toEqual([]);
  });
});

describe('buildClaimSusutFilteredCte', () => {
  it('overlays SAP incoterm/plant without joining qty or company from SAP', () => {
    const { sql, params } = buildClaimSusutFilteredCte(
      {
        importId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        plants: ['BONTANG'],
        sources: [],
        incoterms: [],
        products: ['CPO'],
        groupsOfTransport: ['TRUCK'],
        ddProduct: 'CPO',
        ddPlant: null,
        ddIncoterm: null,
        ddCompany: null,
      },
      'rows',
    );

    expect(sql).toContain('LEFT JOIN sap_by_po');
    expect(sql).toContain('import_keys AS');
    expect(sql).toContain('EXISTS (');
    expect(sql).toContain('contract_latest_spd_snapshot');
    expect(sql).toContain('discharge_destination');
    expect(sql).toContain('c.contract_ext_no');
    expect(sql).not.toContain('sap_processed_data');
    expect(sql).not.toContain('spd_by_po');
    expect(sql).not.toContain('spd_by_ext');
    expect(sql).not.toContain('spd.contract_ext_no');
    expect(sql).not.toContain("Contract Ext No");
    expect(sql).toContain('r.qty_claim');
    expect(sql).toContain('r.amount_after_tax_idr');
    expect(sql).toContain("COALESCE(NULLIF(TRIM(r.vendor_name), ''), '(Blank)') AS company");
    expect(sql).toContain('c.incoterm');
    expect(sql).not.toContain('spd.incoterm');
    expect(sql).not.toContain('master_vessel');
    expect(sql).not.toContain('delivery');
    expect(sql).not.toContain('0.5');
    expect(params[0]).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(sql).toContain('e.cr_date >=');
    expect(sql).toContain('UPPER(e.region_plant) = ANY');
    expect(sql).toContain('e.product = $');
    expect(sql).toContain('UPPER(e.group_of_transport_norm) = ANY');
  });

  it('summary scope ignores drilldown and group-of-transport filters', () => {
    const { sql } = buildClaimSusutFilteredCte(
      {
        importId: null,
        dateFrom: null,
        dateTo: null,
        plants: [],
        sources: [],
        incoterms: [],
        products: [],
        groupsOfTransport: ['TRUCK'],
        ddProduct: 'CPO',
        ddPlant: 'BONTANG',
        ddIncoterm: 'FOB',
        ddCompany: 'PT Example',
      },
      'summary',
    );
    expect(sql).not.toContain('e.group_of_transport_norm');
    expect(sql).not.toContain('e.company = $');
    expect(sql).not.toContain('e.product = $');
    expect(sql).toContain('import_keys AS');
    expect(sql).toContain('EXISTS (');
  });

  it('options scope only keeps import + CR date', () => {
    const { sql } = buildClaimSusutFilteredCte(
      {
        importId: null,
        dateFrom: '2026-01-01',
        dateTo: '2026-09-09',
        plants: ['BONTANG'],
        sources: ['MILL'],
        incoterms: ['FOB'],
        products: ['CPO'],
        groupsOfTransport: [],
        ddProduct: null,
        ddPlant: null,
        ddIncoterm: null,
        ddCompany: null,
      },
      'options',
    );
    expect(sql).toContain('e.cr_date >=');
    expect(sql).not.toContain('UPPER(e.region_plant)');
    expect(sql).not.toContain('UPPER(e.product)');
    expect(sql).not.toContain('UPPER(e.incoterm)');
  });
});

describe('nestClaimSusutTree', () => {
  it('rolls qty and amount into Product → Region/Plant → Incoterm → Company', () => {
    const tree = nestClaimSusutTree([
      {
        product: 'CPO',
        region_plant: 'BONTANG',
        incoterm: CLAIM_SUSUT_BLANK,
        company: 'PT A',
        qty_claim: 1000,
        amount_after_tax_idr: 200,
      },
      {
        product: 'CPO',
        region_plant: 'BONTANG',
        incoterm: CLAIM_SUSUT_BLANK,
        company: 'PT A',
        qty_claim: 500,
        amount_after_tax_idr: 50,
      },
      {
        product: 'CPO',
        region_plant: 'BONTANG',
        incoterm: CLAIM_SUSUT_BLANK,
        company: 'PT B',
        qty_claim: 100,
        amount_after_tax_idr: 10,
      },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].label).toBe('CPO');
    expect(tree[0].qtyClaim).toBe(1600);
    expect(tree[0].amountAfterTax).toBe(260);
    expect(tree[0].children[0].label).toBe('BONTANG');
    expect(tree[0].children[0].children[0].label).toBe(CLAIM_SUSUT_BLANK);
    const companies = tree[0].children[0].children[0].children;
    expect(companies.map((c) => c.label)).toEqual(['PT A', 'PT B']);
    expect(companies[0].qtyClaim).toBe(1500);
    expect(companies[0].amountAfterTax).toBe(250);
  });

  it('uses (Blank) when company / dest / incoterm are empty', () => {
    const tree = nestClaimSusutTree([
      {
        product: '  ',
        region_plant: '',
        incoterm: '',
        company: '',
        qty_claim: 10,
        amount_after_tax_idr: 1,
      },
    ]);
    expect(tree[0].key).toBe(CLAIM_SUSUT_BLANK);
    expect(tree[0].children[0].key).toBe(CLAIM_SUSUT_BLANK);
    expect(tree[0].children[0].children[0].key).toBe(CLAIM_SUSUT_BLANK);
    expect(tree[0].children[0].children[0].children[0].key).toBe(CLAIM_SUSUT_BLANK);
  });
});
