import { describe, expect, it } from 'vitest';
import {
  sqlContractHasNoShipmentExpr,
  sqlContractHasPlannedShipmentExpr,
  sqlContractHasPlannedTruckingExpr,
  sqlContractPlanningStatusFilter,
  sqlContractTruckingUnplannedExpr,
  sqlShipmentStatusColumnExpr,
  sqlTruckingStatusColumnExpr,
} from './contractPlanningStatusSql';

describe('contractPlanningStatusSql', () => {
  it('a trucking operation that is itself UNPLANNED is not a plan', () => {
    const sql = sqlContractHasPlannedTruckingExpr('base');
    expect(sql).toContain("NOT IN ('COMPLETED', 'UNPLANNED')");
    expect(sql).toContain('t_pl.contract_id = base.id');
    expect(sql).toContain("<> 'CANCELLED'");
  });

  it('trucking Unplanned is the exact complement of trucking Planned', () => {
    expect(sqlContractTruckingUnplannedExpr('base')).toBe(`NOT (${sqlContractHasPlannedTruckingExpr('base')})`);
  });

  it('the Planned filter for a land contract reads the trucking predicate, a sea contract the shipment one', () => {
    const sql = sqlContractPlanningStatusFilter(['PLANNED'], { contractAlias: 'base', incotermExpr: 'base.incoterm' }) ?? '';
    expect(sql).toContain(sqlContractHasPlannedTruckingExpr('base'));
    expect(sql).toContain(sqlContractHasPlannedShipmentExpr('base'));
  });

  it('both statuses, or none, is no filter', () => {
    expect(sqlContractPlanningStatusFilter(['PLANNED', 'UNPLANNED'])).toBeNull();
    expect(sqlContractPlanningStatusFilter([])).toBeNull();
  });

  it('sea unplanned is the complement of sea planned', () => {
    expect(sqlContractHasNoShipmentExpr('base')).toBe(`NOT (${sqlContractHasPlannedShipmentExpr('base')})`);
  });

  it('an absent status reads UNPLANNED only in the column of its own mode and only while the contract is still running', () => {
    const ship = sqlShipmentStatusColumnExpr('base');
    const truck = sqlTruckingStatusColumnExpr('base');
    // a real row always wins
    expect(ship).toContain("NULLIF(TRIM(base.shipment_status), '')");
    expect(truck).toContain("NULLIF(TRIM(base.trucking_status), '')");
    // shipment column: sea incoterms; trucking column: the others
    expect(ship).toContain("IN ('CIF', 'FOB', 'CFR', 'CNF')");
    expect(ship).not.toContain('NOT (UPPER');
    expect(truck).toContain("NOT (UPPER(TRIM(COALESCE(base.incoterm, ''))) IN ('CIF', 'FOB', 'CFR', 'CNF'))");
    // a finished contract stays empty - the same predicate the Planning Status filter lets through untouched
    expect(ship).toContain('NOT (');
    expect(ship).toContain('base.import_status');
    expect(truck).toContain('base.import_status');
    expect(ship).toContain("THEN 'UNPLANNED' END");
  });
});
