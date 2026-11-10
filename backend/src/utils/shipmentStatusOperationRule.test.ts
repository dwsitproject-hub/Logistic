import { describe, expect, it } from 'vitest';
import { applyOperationCompletionRule } from './shipmentStatus';

/**
 * Edit Shipment says Completed only when the Shipments table would: for an operation of several POs, when EVERY PO has finished.
 * Case: OP-1004030473-15277540 - the first PO finished on 15 Sep, four POs added on 2 Oct are still waiting; the table read Unloading, the modal Completed.
 */
const rule = (over: Partial<Parameters<typeof applyOperationCompletionRule>[0]>) =>
  applyOperationCompletionRule({ effective: 'COMPLETED', ladderWithoutCompletion: 'PLANNED', operationKeyed: true, memberFinished: [true, false, false, false, false], ...over });

describe('operation completion rule for the Edit Shipment status', () => {
  it('one finished PO among five unfinished ones reads Unloading, like the table (the reported case)', () => {
    expect(rule({})).toBe('UNLOADING');
  });

  it('stays Completed when every PO of the operation has finished', () => {
    expect(rule({ memberFinished: [true, true, true, true, true] })).toBe('COMPLETED');
    expect(rule({ memberFinished: [true, true] })).toBe('COMPLETED');
  });

  it('keeps a later stage of the row ladder when it is further along than the floor, never Completed', () => {
    expect(rule({ ladderWithoutCompletion: 'UNLOADING' })).toBe('UNLOADING');
    expect(rule({ ladderWithoutCompletion: 'BERTHED_DP' })).toBe('UNLOADING'); // floor wins: some PO already finished discharging
  });

  it('with nobody finished the row falls back to its own ladder (a stale stored Completed is not trusted over an unfinished operation)', () => {
    expect(rule({ memberFinished: [false, false, false], ladderWithoutCompletion: 'SAILED' })).toBe('SAILED');
    expect(rule({ memberFinished: [false, false], ladderWithoutCompletion: 'PLANNED' })).toBe('PLANNED');
  });

  it('only ever takes a Completed back: every other status is returned as it is', () => {
    for (const s of ['PLANNED', 'LOADING', 'SAILED', 'UNLOADING', 'CANCELLED'] as const) {
      expect(rule({ effective: s })).toBe(s);
    }
  });

  it('leaves an STO-keyed group and a single-PO operation to the row own reading', () => {
    expect(rule({ operationKeyed: false })).toBe('COMPLETED');
    expect(rule({ memberFinished: [false] })).toBe('COMPLETED');
    expect(rule({ memberFinished: [] })).toBe('COMPLETED');
  });
});
