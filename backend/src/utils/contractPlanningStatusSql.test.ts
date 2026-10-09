import { describe, expect, it } from 'vitest';
import {
  sqlContractHasNoShipmentExpr,
  sqlContractHasPlannedShipmentExpr,
  sqlContractHasPlannedTruckingExpr,
  sqlContractPlanningStatusFilter,
  sqlContractTruckingUnplannedExpr,
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
});
