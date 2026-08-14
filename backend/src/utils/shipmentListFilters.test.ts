import { describe, expect, it } from 'vitest';
import {
  appendShipmentGlobalSearch,
  appendShipmentCharterTypeFilter,
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
  it('matches STO key, shipment_id, operation_id, and PO number', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('COALESCE(c.sto_number)', 3);
    expect(sql).toContain('COALESCE(c.sto_number)');
    expect(sql).toContain('s.shipment_id = $3');
    expect(sql).toContain('s.operation_id');
    expect(sql).toContain('c.po_number');
  });

  it('matches sibling STO numbers on the same contract', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('COALESCE(c.sto_number)', 3);
    expect(sql).toContain('contract_stos cs_search');
    expect(sql).toContain('cs_search.contract_id = c.id');
  });

  it('does not treat FOB Type T sibling STOs as a Shipments search hit', () => {
    const sql = buildExactNumericGlobalSearchInnerSql('COALESCE(c.sto_number)', 3);
    expect(sql).toContain("= 'FOB'");
    expect(sql).toContain("= 'T'");
    expect(sql).toContain('spd_sto_num');
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
    expect(sql).toMatch(/ata_vessel_complete_discharge IS NOT NULL THEN 'UNLOADING'/);
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
