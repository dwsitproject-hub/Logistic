import { describe, expect, it } from 'vitest';
import { ALL_CONTRACT_PRODUCT_OPTIONS_SQL, buildShipmentProductOptionsSql } from './shipmentProductOptionsSql';

describe('Shipments Product filter options', () => {
  const sql = buildShipmentProductOptionsSql().replace(/\s+/g, ' ');

  it('is limited to the page\'s own contract scope: its incoterms, a contract SAP still carries, and no B2B child', () => {
    // the incoterm scope is the one the page uses (effective incoterm of the contract), so the trucking-only products are not offered
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).toContain("COALESCE(c.sap_presence, 'PRESENT') = 'PRESENT'");
    expect(sql).toContain("UPPER(NULLIF(TRIM(COALESCE(l.b2b_flag_raw, '')), '')) = 'B2B'");
    expect(sql).not.toMatch(/FRC|LCO/);
  });

  it('lists each product once, trimmed, in order, and never a blank one', () => {
    expect(sql).toContain('SELECT DISTINCT TRIM(c.product) AS product');
    expect(sql).toContain("NULLIF(TRIM(c.product), '') IS NOT NULL");
    expect(sql).toContain('ORDER BY product');
  });

  it('the unscoped list is what the filter offered before: every product of every contract', () => {
    const all = ALL_CONTRACT_PRODUCT_OPTIONS_SQL.replace(/\s+/g, ' ');
    expect(all).toContain('FROM contracts c');
    expect(all).not.toContain('incoterm');
  });
});
