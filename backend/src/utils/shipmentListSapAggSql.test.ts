import { describe, expect, it } from 'vitest';
import {
  SHIPMENT_LIST_SPD_AGG_CTES_FULL,
  SHIPMENT_LIST_SPD_AGG_CTES_STUB,
  shipmentListSpdAggCtes,
} from './shipmentListSapAggSql';

describe('shipmentListSapAggSql', () => {
  it('returns stub CTEs when skipSapJoin is true', () => {
    expect(shipmentListSpdAggCtes(true)).toBe(SHIPMENT_LIST_SPD_AGG_CTES_STUB);
  });

  it('returns full SAP aggregation CTEs when skipSapJoin is false', () => {
    const full = shipmentListSpdAggCtes(false);
    expect(full).toContain(SHIPMENT_LIST_SPD_AGG_CTES_FULL.trim().slice(0, 40));
    expect(full).toContain('contract_ext_agg');
    expect(full).toContain('quantity_delivered_sap');
    expect(full).toContain('vessel_name_sap');
    expect(full).toContain('sap_vessel_pick');
    expect(full).toContain('sap_loading_ports_agg');
    expect(full).toContain('sto_po_lines');
  });

  /*
   * The contract fallback exists only for rows a STO match cannot serve: synthetic OP-*
   * keys and SAP rows carrying no STO at all. Without that guard a multi-STO contract
   * pulls in SAP rows belonging to a sibling STO, so STO A shows STO B's loading port.
   *
   * This used to be one join with an OR and the guard was a three-way OR chain. It is now
   * a UNION ALL of two branches, so the guard is asserted on the fallback branch instead of
   * on the old chain shape. The third disjunct of that chain (sto expr = sto_key) is
   * deliberately gone: the fallback branch already requires that comparison NOT to hold,
   * which is what keeps the two branches disjoint.
   */
  it('guards contract fallback so multi-STO contracts cannot contaminate page STO', () => {
    const full = shipmentListSpdAggCtes(false);
    expect(full).toContain("~ '^OP-'");
    expect(full).toContain('multi-STO contracts');
    // Fallback applies only to OP-* keys or SAP rows with no STO of their own. The window is
    // generous because sapStoNumberKeyExpr() expands to a long COALESCE over JSONB paths.
    expect(full).toContain("TRIM(spc.sto_key::text) ~ '^OP-'");
    expect(full).toMatch(/~ '\^OP-'[\s\S]{0,900}?IS NULL/);
  });

  /*
   * Equivalence guard for the OR -> UNION ALL rewrite. sap_agg SUMs over spd_keyed, so a
   * pair counted by both branches would inflate quantities. The fallback must exclude
   * anything the STO branch already matched, and it must use IS NOT TRUE rather than NOT
   * (...) because the STO expression can be NULL and the original join treated a NULL
   * comparison as no-match.
   */
  it('keeps the two spd_keyed branches disjoint so SUMs cannot double count', () => {
    const full = shipmentListSpdAggCtes(false);
    expect(full).toContain('UNION ALL');
    expect(full).toContain('IS NOT TRUE');
  });

  /*
   * sap_latest is DISTINCT ON (sto_key) ORDER BY created_at DESC. Real data has many STOs
   * whose SAP rows share created_at to the microsecond with conflicting values (measured:
   * 335 tied groups, 45 with a conflicting B2B flag), so without a final tie-break the
   * winning row - and therefore the b2b_flag shown - depends on the query plan and changes
   * whenever the plan does.
   */
  it('breaks created_at ties deterministically so results do not depend on the plan', () => {
    const full = shipmentListSpdAggCtes(false);
    expect(full).toContain('sk.created_at DESC NULLS LAST');
    expect(full).toContain('sk.spd_id DESC');
  });

  /*
   * B2B children must rank LAST when choosing the row that represents an STO, so b2b_flag
   * cannot describe a contract the page excludes from its row set and from po_numbers_agg.
   *
   * It must be an ORDER BY preference and not a WHERE filter: 259 of 3,871 STOs have only
   * child rows, and filtering would leave them with no sap_latest row at all - blanking
   * b2b_flag and dropping incoterm to a fallback.
   */
  it('ranks B2B child rows last without filtering them out', () => {
    const full = shipmentListSpdAggCtes(false);
    // Anchor on sap_latest: later CTEs (the ports aggregates) have ORDER BY clauses of
    // their own, so searching the whole string finds the wrong one.
    const sapLatest = full.slice(full.indexOf('sap_latest AS ('));
    const orderBy = sapLatest.slice(sapLatest.indexOf('ORDER BY'));

    expect(orderBy).toContain('THEN 1 ELSE 0 END');
    // The child test must come BEFORE created_at, or a newer child would still win.
    expect(orderBy.indexOf('CASE WHEN')).toBeGreaterThan(-1);
    expect(orderBy.indexOf('CASE WHEN')).toBeLessThan(orderBy.indexOf('sk.created_at'));
    // Preference, not filter: sap_latest must not gain a child-exclusion WHERE clause.
    expect(sapLatest).toContain('WHERE sk.sto_key IS NOT NULL');
    expect(sapLatest.slice(0, sapLatest.indexOf('ORDER BY'))).not.toContain('contract_reference_po');
  });

  it('reads SAP source_type and incoterm from contract JSON and raw Excel columns', () => {
    const full = shipmentListSpdAggCtes(false);
    expect(full).toContain("sk.data->'raw'->>'Source'");
    expect(full).toContain("sk.data->'raw'->>'Source_Type'");
    expect(full).toContain("sk.data->'raw'->>'Incoterm'");
  });

  it('sums sap_agg delivery from Quantity Delivery Vessel/Trucking (same as modal)', () => {
    const full = shipmentListSpdAggCtes(false);
    expect(full).toContain('Quantity Delivery Vessel');
    expect(full).toContain('Quantity Delivery Trucking');
  });

  it('sums sap_agg from the latest SAP row per contract+PO, not every import', () => {
    const full = shipmentListSpdAggCtes(false);
    expect(full).toContain('sap_keyed_qty_latest AS (');
    expect(full).toContain('FROM sap_keyed_qty_latest sk');
    expect(full).toContain('spd.contract_number');
    expect(full).toContain('spd.po_number');
  });

  it('exposes spd_id in both the stub and full CTEs so the shapes stay compatible', () => {
    expect(shipmentListSpdAggCtes(true)).toContain('spd_id');
    expect(shipmentListSpdAggCtes(false)).toContain('spd_id');
  });
});
