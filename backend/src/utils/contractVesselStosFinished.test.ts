import { describe, expect, it } from 'vitest';
import { isContractEffectivelyDone, sqlContractEffectivelyDoneExpr } from './contractDeliveryStatus';
import { buildVesselStosFinishedCte } from './contractsListCycleSql';

describe('a PO whose every vessel STO has a finished shipment is done (Ryan 2026-10-16, Shipping Performance rule)', () => {
  it('JS: done although its trucking STOs make sto_count > 1 and GR still says Open (PS23 1014003274)', () => {
    const row = { outstanding_quantity: 1_000_000, last_ata_vessel_complete_discharge: '2026-10-15', sto_count: 4, all_stos_discharged: false };
    expect(isContractEffectivelyDone(row)).toBe(false);
    expect(isContractEffectivelyDone({ ...row, vessel_stos_finished: true })).toBe(true);
  });

  it('JS: an unfinished vessel STO keeps the old answer (PO 1004030633 stays Open)', () => {
    expect(isContractEffectivelyDone({ outstanding_quantity: 402_660, last_ata_vessel_complete_discharge: '2026-08-21', sto_count: 2, vessel_stos_finished: false })).toBe(false);
  });

  it('SQL: the arm is added only when a caller supplies it', () => {
    const base = { outstandingKgExpr: 'b.os', atcExpr: 'b.atc', stoCountExpr: 'b.n' };
    expect(sqlContractEffectivelyDoneExpr(base)).not.toContain('vessel_stos_finished');
    expect(sqlContractEffectivelyDoneExpr({ ...base, vesselStosFinishedExpr: 'b.vessel_stos_finished' })).toContain('OR COALESCE((b.vessel_stos_finished), FALSE)');
  });

  it('CTE: vessel STOs only, cancelled shipments ignored, B2B origins read their children', () => {
    const sql = buildVesselStosFinishedCte('v', 'SELECT 1');
    expect(sql).toContain("UPPER(TRIM(COALESCE(cvs.sto_type, ''))) <> 'T'");
    expect(sql).toContain("UPPER(TRIM(COALESCE(s_vf.status, ''))) <> 'CANCELLED'");
    expect(sql).toContain('TRIM(lch.contract_reference_po_raw) = TRIM(co.po_number::text)');
    expect(sql).toContain('BOOL_AND(links.finished) AS vessel_stos_finished');
  });
});
