import { describe, expect, it } from 'vitest';
import {
  isContractEffectivelyDone,
  resolveContractEffectiveStatusText,
  sqlContractEffectivelyDoneExpr,
} from './contractDeliveryStatus';

describe('an ATC finishes a PO only when the PO has one STO', () => {
  /*
   * `last_ata_vessel_complete_discharge` is a MAX across the PO, so on a PO carrying several STOs
   * one discharged STO closed the whole contract while another was still Open with quantity left.
   *
   * PO 1004030633 is the worked case: STO 1006019438 discharged (97,340 kg, GR Close) while STO
   * 1006019958 still held 402,660 kg with GR Open. Contract Performance called the PO Close and
   * dropped its 403 MT; the Shipments OS went on counting it, and that was the last of the
   * discrepancy between the two pages.
   *
   * Multi-STO POs are not an edge case: 2,706 POs have more than one STO against 2,592 with one.
   */
  const open = {
    import_status: 'Open',
    outstanding_quantity: 402_660,
    last_ata_vessel_complete_discharge: '2026-07-20',
  };

  it('keeps a multi-STO PO open when only one of its STOs has discharged', () => {
    expect(isContractEffectivelyDone({ ...open, sto_count: 2 })).toBe(false);
    expect(resolveContractEffectiveStatusText({ ...open, sto_count: 2 })).toBe('OPEN');
  });

  it('still closes a single-STO PO whose vessel discharged while GR lags', () => {
    // The case the arm exists for - unchanged.
    expect(isContractEffectivelyDone({ ...open, sto_count: 1 })).toBe(true);
    expect(resolveContractEffectiveStatusText({ ...open, sto_count: 1 })).toBe('CLOSE');
  });

  it('treats an unknown STO count as one, so nothing changes where the count is absent', () => {
    expect(isContractEffectivelyDone(open)).toBe(true);
  });

  it('closes a multi-STO PO once nothing is outstanding', () => {
    // The quantity arm is untouched: delivered in full is finished however many STOs there were.
    expect(isContractEffectivelyDone({ ...open, sto_count: 3, outstanding_quantity: 0 })).toBe(true);
  });

  it('mirrors the rule in SQL when a count expression is supplied', () => {
    const sql = sqlContractEffectivelyDoneExpr({
      outstandingKgExpr: 'base.outstanding_quantity',
      atcExpr: 'base.last_ata_vessel_complete_discharge',
      stoCountExpr: 'base.sto_count',
    });
    expect(sql).toContain('base.sto_count');
    expect(sql).toContain('<= 1');
    // Without one, the expression keeps its previous shape for callers that carry no count.
    expect(
      sqlContractEffectivelyDoneExpr({ outstandingKgExpr: 'os', atcExpr: 'atc' }),
    ).not.toContain('sto_count');
  });
});
