import { describe, expect, it } from 'vitest';
import {
  appendShipmentGlobalSearch,
  appendShipmentCharterTypeFilter,
  appendShipmentSourceTypeFilter,
  buildExactNumericGlobalSearchInnerSql,
  isExactStoGlobalSearch,
  shipmentEffectiveStatusExpr,
} from './shipmentListFilters';

describe('isExactStoGlobalSearch', () => {
  it('matches 10-digit SAP STO keys', () => {
    expect(isExactStoGlobalSearch('1016010973')).toBe(true);
  });

  it('matches 10-digit SAP PO numbers', () => {
    expect(isExactStoGlobalSearch('1011003113')).toBe(true);
  });

  it('rejects partial or non-numeric search', () => {
    expect(isExactStoGlobalSearch('101601097')).toBe(false);
    expect(isExactStoGlobalSearch('10160109731')).toBe(false);
    expect(isExactStoGlobalSearch('MV PACIFIC')).toBe(false);
    expect(isExactStoGlobalSearch('')).toBe(false);
  });
});

describe('buildExactNumericGlobalSearchInnerSql', () => {
  /*
   * A contract with no STO line was unfindable by its own number.
   *
   * The identity branch reaches other contracts' numbers only when they share the row's STO, and
   * the direct tests covered the STO key, the shipment id, the operation id and the PO - never the
   * shipment's own contract_id. Ryan reported it on 2026-09-22: searching 1004030359 returned
   * nothing while the contract filter and a vessel search both returned the row it sits on, and
   * the OS card was counting its 3,010 MT the whole time. That contract has 0 rows in
   * contract_stos, so every STO-keyed branch failed.
   */
  it('matches the shipment OWN contract number, so a contract with no STO is findable', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('COALESCE(c.sto_number)', 3);
    expect(sql).toContain("TRIM(COALESCE(c.contract_id::text, '')) = TRIM($3::text)");
  });

  /*
   * And it must not be inside the STO-linked EXISTS, which is what keeps it from fanning out to
   * every sibling STO row on the PO - the failure the existing comment in the builder warns about.
   */
  it('tests the own contract number OUTSIDE the STO-linked EXISTS', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('COALESCE(c.sto_number)', 3);
    const own = sql.indexOf("TRIM(COALESCE(c.contract_id::text, '')) = TRIM($3::text)");
    const exists = sql.indexOf('FROM contracts c_ident');
    expect(own).toBeGreaterThan(-1);
    expect(exists).toBeGreaterThan(-1);
    expect(own).toBeLessThan(exists);
  });

  it('matches STO key, shipment_id, operation_id, and PO number', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('COALESCE(c.sto_number)', 3);
    expect(sql).toContain('COALESCE(c.sto_number)');
    expect(sql).toContain('s.shipment_id = $3');
    expect(sql).toContain('s.operation_id');
    expect(sql).toContain('c.po_number');
  });

  it('does not fan out to sibling STOs on the same contract', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('COALESCE(c.sto_number)', 3);
    expect(sql).not.toContain('cs_search');
    expect(sql).not.toMatch(/contract_stos cs_search/);
  });

  /*
   * The list groups by STO and several contracts can share one STO, so the row's PO column
   * aggregates across all of them. Without this branch a PO could be printed on the row and
   * still return nothing when searched (staging: 1011003113 on STO 1016010973).
   */
  it('matches PO / contract numbers of other contracts sharing the row STO', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('COALESCE(c.sto_number)', 3);
    expect(sql).toContain('contracts c_ident');
    expect(sql).toContain('c_ident.po_number');
    expect(sql).toContain('c_ident.contract_id');
    // Linkage must be checked against the row's STO key, not the searched value.
    expect(sql).toContain('contract_stos cs_ident');
    expect(sql).toContain('cs_ident.contract_id = c_ident.id');
  });

  it('uses the row STO key expression for the linkage and the param for identity', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('MY_STO_KEY_EXPR', 7);
    // Identity side compares against the search parameter...
    expect(sql).toContain("TRIM(COALESCE(c_ident.po_number::text, '')) = TRIM($7::text)");
    // ...while the linkage side compares against this row's STO key. Swapping these would
    // make every contract with that STO match regardless of the search term.
    expect(sql).toContain('TRIM(MY_STO_KEY_EXPR)');
  });

  it('binds every branch to the same single parameter index', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('COALESCE(c.sto_number)', 5);
    expect(sql).not.toContain('$6');
    expect(sql).not.toContain('$4');
    expect(sql.match(/\$5/g)!.length).toBeGreaterThanOrEqual(5);
  });
});

describe('appendShipmentGlobalSearch', () => {
  it('returns empty SQL for exact STO search (handled by inner fast path)', () => {
    const result = appendShipmentGlobalSearch('1016010973', 3);
    expect(result.sql).toBe('');
    expect(result.params).toEqual([]);
    expect(result.nextIndex).toBe(3);
  });

  it('returns empty SQL for exact 10-digit PO search (handled by inner fast path)', () => {
    const result = appendShipmentGlobalSearch('1011003113', 3);
    expect(result.sql).toBe('');
    expect(result.params).toEqual([]);
    expect(result.nextIndex).toBe(3);
  });

  it('returns ILIKE filter for non-exact search', () => {
    const result = appendShipmentGlobalSearch('vessel', 2);
    expect(result.sql).toContain('ILIKE');
    expect(result.params).toEqual(['%vessel%']);
    expect(result.nextIndex).toBe(3);
  });
});

describe('shipmentEffectiveStatusExpr', () => {
  it('uses ATA ladder and GR Close without persisted group_status_floor demotion', () => {
    const sql = shipmentEffectiveStatusExpr('f');
    expect(sql).toContain('is_contract_sap_closed');
    expect(sql).toContain('ata_vessel_sailed_from_loading_port');
    expect(sql).toContain('ata_vessel_complete_discharge');
    expect(sql).toMatch(/is_contract_sap_closed[\s\S]*THEN 'COMPLETED'/);
    // ATC completes the shipment; only discharge that started but did not finish is UNLOADING.
    expect(sql).toMatch(/ata_vessel_complete_discharge IS NOT NULL THEN 'COMPLETED'/);
    expect(sql).toMatch(/ata_vessel_start_discharging IS NOT NULL THEN 'UNLOADING'/);
    expect(sql).not.toContain('group_status_floor');
  });
});

describe('appendShipmentCharterTypeFilter', () => {
  it('filters T/C including legacy TC storage', () => {
    const result = appendShipmentCharterTypeFilter('T/C', 4);
    expect(result.sql).toContain("= $4::text");
    expect(result.params).toEqual(['T/C']);
    expect(result.nextIndex).toBe(5);
    expect(result.sql).toContain("WHEN");
    expect(result.sql).toContain("'TC'");
  });

  it('returns empty SQL for ALL', () => {
    const result = appendShipmentCharterTypeFilter('ALL', 2);
    expect(result.sql).toBe('');
    expect(result.params).toEqual([]);
    expect(result.nextIndex).toBe(2);
  });
});

describe('appendShipmentSourceTypeFilter', () => {
  it('returns empty SQL for ALL', () => {
    const result = appendShipmentSourceTypeFilter('ALL', 3);
    expect(result.sql).toBe('');
    expect(result.params).toEqual([]);
    expect(result.nextIndex).toBe(3);
  });

  it('filters Interco on contract_source_type', () => {
    const result = appendShipmentSourceTypeFilter('Interco', 3);
    expect(result.sql).toContain('sb.contract_source_type');
    expect(result.sql).toMatch(/INTERCO|INHOUSE/);
    expect(result.params).toEqual([]);
    expect(result.nextIndex).toBe(3);
  });

  it('filters 3rd Party on contract_source_type', () => {
    const result = appendShipmentSourceTypeFilter('3rd Party', 3);
    expect(result.sql).toContain('sb.contract_source_type');
    expect(result.sql).toMatch(/3RD.*PARTY/);
    expect(result.params).toEqual([]);
  });
});
