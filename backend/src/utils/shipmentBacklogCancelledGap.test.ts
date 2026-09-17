import { describe, expect, it } from 'vitest';
import { contractBacklogCoreWhereSql } from './shipmentUnplannedHybridSql';
import { truckingUnplannedContractBacklogBaseWhereSql } from './truckingUnplannedHybridSql';
import { sqlContractHasNoRegisteredEtaExpr } from './shipmentPagePipelineSql';

describe('a contract whose shipments are all cancelled still reaches the backlog', () => {
  it('excludes a contract only when it has a NON-cancelled shipment', () => {
    const sql = contractBacklogCoreWhereSql('c', 'l');
    /*
     * The gap this closes: the execution OS buckets span only the active stages, so a contract
     * with nothing but cancelled shipments was in neither arm and vanished from the Shipments OS
     * while Contract Performance still counted it. CFR showed it most plainly - its one Open
     * contract is exactly that case, and the card read 0.
     */
    expect(sql).toMatch(/FROM shipments s_ns[\s\S]*?s_ns\.status[\s\S]*?<> 'CANCELLED'/);
  });

  it('matches the shape Trucking already had - active rows exclude, dead ones do not', () => {
    // Trucking's OS agreed with Contract Performance precisely because of this; Shipments did not.
    const trucking = truckingUnplannedContractBacklogBaseWhereSql('c', 'l');
    expect(trucking).toContain('trucking_operations t_ns');
    // Both pages now qualify the NOT EXISTS rather than excluding on mere presence of a row.
    expect(contractBacklogCoreWhereSql('c', 'l')).not.toMatch(
      /SELECT 1 FROM shipments s_ns WHERE s_ns\.contract_id = c\.id\s*\)/,
    );
  });
});

describe("a cancelled shipment's ETA is not a registered plan", () => {
  it('ignores cancelled shipments when deciding whether a contract is already planned', () => {
    /*
     * The second half of the same gap. Treating a cancelled shipment's ETA as a registered plan
     * dropped the contract out of the Unplanned backlog, while having no live shipment kept it out
     * of the execution arm - so it sat in neither and its OS vanished. Found by diffing the two
     * pages contract by contract: 1004030361 (CIF, 508 MT) was the only one left over, and 508 MT
     * was exactly the CIF discrepancy.
     */
    expect(sqlContractHasNoRegisteredEtaExpr('c')).toMatch(
      /s_eta\.status[\s\S]*?<> 'CANCELLED'/,
    );
  });
});
