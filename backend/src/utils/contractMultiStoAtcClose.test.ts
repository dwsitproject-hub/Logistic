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

describe('...unless every one of those STOs has discharged', () => {
  /*
   * The sto_count guard was standing in for a test nobody could make at the time: "are they ALL
   * discharged?". Now that sqlContractEveryStoDischargedExpr answers it directly, a multi-STO PO
   * that has genuinely finished stops being held open by a rule meant to catch the opposite case.
   *
   * Measured on a copy of production before the change: 0 contracts move today. It is a rule made
   * correct for the data that will arrive, not a fix for a number on a page now.
   */
  const open = {
    import_status: 'Open',
    outstanding_quantity: 402_660,
    last_ata_vessel_complete_discharge: '2026-07-20',
    sto_count: 2,
  };

  it('closes a multi-STO PO when every STO has discharged', () => {
    expect(isContractEffectivelyDone({ ...open, all_stos_discharged: true })).toBe(true);
    expect(resolveContractEffectiveStatusText({ ...open, all_stos_discharged: true })).toBe('CLOSE');
  });

  it('still holds PO 1004030633 open while one STO has not', () => {
    expect(isContractEffectivelyDone({ ...open, all_stos_discharged: false })).toBe(false);
  });

  it('keeps the old answer when the row does not carry the column at all', () => {
    // Every caller that has not been wired up yet lands here, so this is the no-change guarantee.
    expect(isContractEffectivelyDone(open)).toBe(false);
  });

  it('does not close a PO that has discharged nothing, whatever the flag says', () => {
    // The ATC arm still requires an ATC: "all of them" over an empty set must not finish a PO.
    const noAtc = { ...open, last_ata_vessel_complete_discharge: null };
    expect(isContractEffectivelyDone({ ...noAtc, all_stos_discharged: true })).toBe(false);
  });

  it('takes only a real boolean, so a mistyped column fails loudly rather than closing POs', () => {
    expect(isContractEffectivelyDone({ ...open, all_stos_discharged: 'true' })).toBe(false);
  });

  it('mirrors the arm in SQL, and omits it for callers that supply no expression', () => {
    const withArm = sqlContractEffectivelyDoneExpr({
      outstandingKgExpr: 'base.outstanding_quantity',
      atcExpr: 'base.last_ata_vessel_complete_discharge',
      stoCountExpr: 'base.sto_count',
      everyStoDischargedExpr: 'base.all_stos_discharged',
    });
    expect(withArm).toContain('base.all_stos_discharged');
    expect(withArm).toContain('<= 1 OR');

    const withoutArm = sqlContractEffectivelyDoneExpr({
      outstandingKgExpr: 'base.outstanding_quantity',
      atcExpr: 'base.last_ata_vessel_complete_discharge',
      stoCountExpr: 'base.sto_count',
    });
    expect(withoutArm).not.toContain('all_stos_discharged');
    expect(withoutArm).toContain('<= 1');
  });
});
