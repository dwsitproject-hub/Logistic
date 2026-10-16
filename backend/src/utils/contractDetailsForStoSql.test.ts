import { describe, expect, it } from 'vitest';
import {
  buildContractDetailsForStoSql,
  sqlSiblingShipmentKlipQtyExpr,
} from './contractDetailsForStoSql';

describe('sqlSiblingShipmentKlipQtyExpr', () => {
  it('reads KLIP delivered/receive from sibling shipment under lookup key', () => {
    const delivered = sqlSiblingShipmentKlipQtyExpr('pl.contract_number', 'delivered');
    expect(delivered).toContain('quantity_delivered_klip');
    expect(delivered).toContain('operation_id');
    expect(delivered).toContain('shipment_id');
    expect(delivered).toContain('contract_stos');
    expect(delivered).toContain('user_sto_contract_assignments');
    expect(delivered).toContain("LIKE TRIM($1::text) || '-%'");
    expect(delivered).toContain('pl.contract_number');
    const receive = sqlSiblingShipmentKlipQtyExpr('pl.contract_number', 'receive');
    expect(receive).toContain('actual_vessel_qty_receive');
  });
});

describe('buildContractDetailsForStoSql OS Qty of a PO line', () => {
  const sql = buildContractDetailsForStoSql();
  const flat = sql.replace(/\s+/g, ' ');

  it('several STOs on the PO: the PO-level OS (Contract Qty less the TOTAL Delivery/Receive of every STO, by incoterm), as the View Table shows it', () => {
    // the qty_move figures come from the snapshot by primary key
    expect(flat).toContain('qty_move AS NOT MATERIALIZED');
    expect(flat).toContain('FROM contract_qty_move_snapshot');
    expect(flat).toContain('SELECT qm.quantity_receive FROM qty_move qm WHERE qm.contract_number = pl.contract_number');
    // chosen per PO line by the number of distinct SAP STOs of the PO
    expect(flat).toContain('FROM sap_processed_data spd_cnt');
    expect(flat).toContain(')::int, 1) > 1 THEN');
  });

  it('the STO\'s own Qty is not a base for OS any more', () => {
    expect(flat).not.toContain('sqlShipmentListOsBaseQtyExpr');
    expect(flat).not.toContain('sap_sto_qty');
    // a single STO still reads Contract Qty less that STO's fulfilled
    expect(flat).toContain('COALESCE((pl.contract_qty)::numeric, 0)');
  });

  it('tells the page how many STOs the PO has and which contract row to ask for their list', () => {
    expect(flat).toContain('AS po_sto_count');
    expect(flat).toContain('pl.contract_row_id');
    expect(flat).toContain('NULL::uuid AS contract_row_id');
    expect(flat).toContain('c.id AS contract_row_id');
  });

  it('both UNION arms carry the same OS and count columns', () => {
    expect(flat.match(/ AS po_sto_count/g)?.length).toBe(2);
    expect(flat.match(/ AS incoterm,/g)?.length).toBe(2);
    expect(flat.match(/ AS outstanding_qty_actual/g)?.length).toBe(2);
  });
});

describe('buildContractDetailsForStoSql B2B origin line', () => {
  it('carries the Delivery / Receive its B2B children booked on this STO, and its OS follows', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('INNER JOIN latest_spd_b2b chb ON chb.contract_number = ch.contract_number');
    expect(sql).toContain('TRIM(chb.contract_reference_po) = TRIM(pl.po_number)');
    expect(sql).toContain('ch.contract_number <> pl.contract_number');
  });
});

describe('buildContractDetailsForStoSql', () => {
  it('discovers contracts by sto_number and returns one row per PO line', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('contract_stos');
    expect(sql).toContain('c.sto_number::text');
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('s.shipment_id::text');
    expect(sql).toContain('user_sto_contract_assignments');
    expect(sql).toContain('po_lines');
    expect(sql).toContain('pl.po_number');
    expect(sql).toContain('pl.incoterm');
    expect(sql).toContain('pl.contract_qty');
    expect(sql).toContain('raw_quantity_delivery_vessel');
    expect(sql).toContain("~ '^(OP-|MNL-|MSEA-)'");
    expect(sql).toContain("'Operation ID'");
    expect(sql).toContain('po_number::text');
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain("IN ('SEA', 'MIXED', 'MIX')");
    // Blank-STO fallback must be contract-scoped (Edit Shipment PO list), not global discover.
    expect(sql).toContain('spd.contract_number = pl.contract_number');
    expect(sql).toContain('AS quantity_delivered_klip');
    expect(sql).toContain('AS quantity_receive_klip');
    expect(sql).not.toContain('AS shipment_plan_qty');
    expect(sql).not.toContain('AS sto_qty_assigned');
    expect(sql).not.toContain('AS outstanding_qty_planning');
    expect(sql).not.toContain('AS sap_sto_qty');
  });

  it('uses shared STO+PO scoped delivery/receive SQL per PO line', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('pl.po_number');
    expect(sql).toContain('$1::text');
    expect(sql).toContain('raw_quantity_delivery_vessel');
    expect(sql).toContain('raw_quantity_receive');
    // Edit Shipment path: latest SAP row per PO+STO (not SUM of sibling POs on shared STO).
    expect(sql).toContain('LIMIT 1');
    expect(sql).toContain('pl.contract_number');
  });

  it('excludes B2B child PO lines (Contract Reff PO set)', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('latest_spd_b2b');
    expect(sql).toContain("= 'B2B'");
    expect(sql).toContain('contract_reference_po');
    expect(sql).toContain('LEFT JOIN latest_spd_b2b b2b ON b2b.contract_number = pl.contract_number');
  });
});

/*
 * The B2B lookup must be scoped, and it must stay below the CTEs it is scoped to.
 *
 * Unscoped it was a DISTINCT ON over every sap_processed_data row, detoasting the jsonb column on
 * each to read two fields - the largest single cost of opening the shipment edit modal
 * (1,193-3,953 ms per call on a copy of production, against 229-278 ms scoped). It is only ever
 * joined to po_lines and sap_only_contracts, so limiting it to those contract numbers drops only
 * rows no join could have matched: verified by comparing contractDetails for 12 shipments before
 * and after - identical, 12/12.
 */
describe('the B2B lookup is scoped to the contracts this query can join', () => {
  it('restricts latest_spd_b2b to po_lines and sap_only_contracts', () => {
    const sql = buildContractDetailsForStoSql();
    expect(sql).toContain('SELECT pl_s.contract_number FROM po_lines pl_s');
    expect(sql).toContain('SELECT soc_s.contract_number FROM sap_only_contracts soc_s');
  });

  it('defines it AFTER both, or the scope cannot resolve', () => {
    const sql = buildContractDetailsForStoSql();
    const poLines = sql.indexOf('po_lines AS (');
    const sapOnly = sql.indexOf('sap_only_contracts AS (');
    const b2b = sql.indexOf('latest_spd_b2b AS (');
    expect(poLines).toBeGreaterThan(-1);
    expect(sapOnly).toBeGreaterThan(-1);
    expect(b2b).toBeGreaterThan(sapOnly);
    expect(b2b).toBeGreaterThan(poLines);
  });
});
