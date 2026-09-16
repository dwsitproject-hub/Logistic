import { describe, expect, it } from 'vitest';
import { contractBacklogCoreWhereSql } from './shipmentUnplannedHybridSql';
import {
  sqlContractIsB2bOriginOfShippedChildExpr,
  sqlShipmentListB2bOriginContractJoins,
} from './shipmentB2bOriginSql';

describe('a B2B origin is not counted by both Shipments OS arms', () => {
  /*
   * The Shipments OS is a union of two arms whose safety rests entirely on their being disjoint.
   * The execution arm attributes a shipment through shipment_base.contract_numbers, which is built
   * over `c.id = COALESCE(c_origin.id, c_link.id)` - so a B2B child's shipment is re-attributed to
   * the ORIGIN contract. The backlog arm's guards only look for a shipment pointing AT a contract,
   * and nothing points at the origin: the child owns the shipment and the origin carries no STO.
   *
   * Both arms therefore counted the origin's outstanding quantity. Measured on the dev copy
   * 2026-09-16: 4 FOB origins, 9,500 MT counted twice, which was the largest single component of
   * the 8,319 MT by which the Shipments FOB OS card exceeded Contract Performance. CIF and CFR,
   * which already agreed to the MT, were unaffected by the fix - confirmed by re-measuring both.
   */
  it('excludes a contract whose B2B child is already on a live shipment', () => {
    expect(contractBacklogCoreWhereSql('c', 'l')).toContain(
      sqlContractIsB2bOriginOfShippedChildExpr('c'),
    );
  });

  it('keys the origin the same way the execution arm remaps it', () => {
    // The remap matches the child's contract_reference_po against a contract's po_number; the
    // guard has to read the same two fields or it protects a different set of contracts.
    const guard = sqlContractIsB2bOriginOfShippedChildExpr('c');
    expect(sqlShipmentListB2bOriginContractJoins()).toContain('contract_reference_po_raw');
    expect(guard).toContain('contract_reference_po_raw');
    expect(guard).toContain('c.po_number');
  });

  it('only counts the child as shipped when the shipment is not cancelled', () => {
    // A cancelled shipment leaves the origin genuinely unshipped, and the backlog is where it
    // belongs - the same rule the cancelled-shipment gap established for the other guards.
    expect(sqlContractIsB2bOriginOfShippedChildExpr('c')).toMatch(
      /s_b2b_child\.status[\s\S]*?<> 'CANCELLED'/,
    );
  });

  it('requires the child to actually be B2B', () => {
    // Without the flag test any contract sharing a PO reference would suppress the origin.
    expect(sqlContractIsB2bOriginOfShippedChildExpr('c')).toContain("= 'B2B'");
  });
});
