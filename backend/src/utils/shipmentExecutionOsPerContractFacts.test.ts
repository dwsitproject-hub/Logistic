import { describe, expect, it } from 'vitest';
import { sqlShipmentExecutionOsPerContractCtes } from './shipmentOutstandingQtySummarySql';

describe('the execution OS decides per contract, not per STO group', () => {
  /*
   * Fourth instance of one shape in this investigation: a group-level aggregate deciding a
   * contract-level fact. The first three were the B2B origin counted by both arms, a sibling STO's
   * discharge finishing the wrong group, and an ATC closing a multi-STO PO.
   *
   * Measured in production on 2026-09-16, where the whole remaining Shipments-vs-Contract
   * Performance difference was 11 contracts:
   *
   *   incoterm  1,050 MT  1004030388/1004030695/1004030753 (FRC) and 9184100081 (LCO) were bucketed
   *             as FOB from the STO group's incoterm, which also valued them off the vessel
   *             delivery column instead of the trucking one - Contract Performance had them at
   *             0-3 MT against 100-750 MT here.
   *   GR Close    608 MT  1004029445 (FOB) plus 1004030942/1004030943 (CIF) kept contributing
   *             because is_contract_sap_closed is a BOOL_AND over the group, so a group finishes
   *             only when every contract in it has.
   */
  const sql = sqlShipmentExecutionOsPerContractCtes('enriched');

  it("buckets a row by the contract's own incoterm, falling back to the group's", () => {
    expect(sql).toContain('c.incoterm FROM contracts c WHERE c.contract_id = r.contract_number');
    // The contract's own value must come first in the COALESCE, or the group's wins again.
    const bucket = sql.slice(sql.indexOf('AS incoterm') - 400, sql.indexOf('AS incoterm'));
    expect(bucket.indexOf('c.incoterm')).toBeLessThan(bucket.lastIndexOf('r.os_incoterm'));
  });

  it("values the outstanding quantity from the contract's own incoterm too", () => {
    // The incoterm selects the delivery column, so a wrong bucket is also a wrong quantity.
    expect(sql).not.toMatch(/incotermExpr[\s\S]{0,40}COALESCE\(NULLIF\(TRIM\(r\.os_incoterm/);
  });

  it('drops a contract whose own GR says Close', () => {
    expect(sql).toContain('c_closed.contract_id = TRIM(cn)');
    expect(sql).toMatch(/AND NOT \(EXISTS \(\s*SELECT 1 FROM contracts c_closed/);
  });

  it('leaves the grouped is_contract_sap_closed flag alone', () => {
    /*
     * That flag also drives the list's status column, where "every contract closed" is the right
     * question to ask of a row standing for the whole group. Only the OS, which is per contract,
     * needed the narrower test.
     */
    expect(sql).not.toContain('BOOL_AND');
  });
});
