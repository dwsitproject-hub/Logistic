import { describe, expect, it } from 'vitest';
import {
  isStoDeletedWithLiveSibling,
  markStoDeletedWithLiveSibling,
  markSupersededDeletedPoLines,
  sapDeleteForcesContractCancel,
  type DeletedPoLineCandidate,
} from './sapDeletedPoLines';

const line = (contract: string | null, po: string | null, deletePo?: string): DeletedPoLineCandidate => ({
  contractNumber: contract,
  poNumber: po,
  parsedData: { contract: deletePo === undefined ? {} : { delete_po_status: deletePo } },
});

describe('markSupersededDeletedPoLines', () => {
  it('the case from SAP: one line deleted (S), one open - the deleted one is set aside, the open one decides', () => {
    const open = line('1004031313', '1001031313');
    const deleted = line('1004031313', '1001031313', 'S');
    expect(markSupersededDeletedPoLines([open, deleted])).toBe(1);
    expect(deleted.supersededDeletedPoLine).toBe(true);
    expect(open.supersededDeletedPoLine).toBeUndefined();
  });

  it('does not depend on the order of the lines', () => {
    const deleted = line('C1', 'P1', 'S');
    const open = line('C1', 'P1');
    markSupersededDeletedPoLines([deleted, open]);
    expect(deleted.supersededDeletedPoLine).toBe(true);
    expect(open.supersededDeletedPoLine).toBeUndefined();
  });

  it('every line deleted: the PO really is cancelled, nothing is set aside', () => {
    const a = line('C1', 'P1', 'S');
    const b = line('C1', 'P1', 'L');
    expect(markSupersededDeletedPoLines([a, b])).toBe(0);
    expect(a.supersededDeletedPoLine).toBeUndefined();
    expect(b.supersededDeletedPoLine).toBeUndefined();
  });

  it('a single line, deleted or not, is left alone', () => {
    const only = line('C1', 'P1', 'S');
    expect(markSupersededDeletedPoLines([only])).toBe(0);
    expect(only.supersededDeletedPoLine).toBeUndefined();
  });

  it('sets aside every deleted line when the PO has one open line', () => {
    const rows = [line('C1', 'P1', 'S'), line('C1', 'P1'), line('C1', 'P1', 'L')];
    expect(markSupersededDeletedPoLines(rows)).toBe(2);
    expect(rows.map((r) => Boolean(r.supersededDeletedPoLine))).toEqual([true, false, true]);
  });

  it('the open line of the PO has a BLANK Contract No while the deleted line names it: still one PO, the deleted line is set aside (PO 1001031718, 2026-10-13)', () => {
    const open = line(null, '1001031718');
    const deleted = line('1004031718', '1001031718', 'S');
    expect(markSupersededDeletedPoLines([open, deleted])).toBe(1);
    expect(deleted.supersededDeletedPoLine).toBe(true);
    expect(open.supersededDeletedPoLine).toBeUndefined();
  });

  it('a blank Contract No does not depend on the order of the lines, and whitespace counts as blank', () => {
    const deleted = line('1004031718', '1001031718', 'S');
    const open = line('  ', '1001031718');
    markSupersededDeletedPoLines([deleted, open]);
    expect(deleted.supersededDeletedPoLine).toBe(true);
  });

  it('a deleted line with a blank Contract No next to an open named line is set aside too', () => {
    const open = line('C1', 'P1');
    const deleted = line(null, 'P1', 'S');
    expect(markSupersededDeletedPoLines([open, deleted])).toBe(1);
    expect(deleted.supersededDeletedPoLine).toBe(true);
  });

  it('every line deleted - one of them with a blank Contract No - the PO is still cancelled', () => {
    const a = line(null, 'P1', 'S');
    const b = line('C1', 'P1', 'S');
    expect(markSupersededDeletedPoLines([a, b])).toBe(0);
  });

  it('one PO under two different contract numbers keeps the contract in the key, so the two are not mixed', () => {
    const openC1 = line('C1', 'P1');
    const deletedC2 = line('C2', 'P1', 'S');
    expect(markSupersededDeletedPoLines([openC1, deletedC2])).toBe(0);
    expect(deletedC2.supersededDeletedPoLine).toBeUndefined();
  });

  it('is per Contract + PO: another PO or another contract is not affected', () => {
    const otherPo = line('C1', 'P2', 'S');
    const otherContract = line('C2', 'P1', 'S');
    const open = line('C1', 'P1');
    const deleted = line('C1', 'P1', 'S');
    markSupersededDeletedPoLines([otherPo, otherContract, open, deleted]);
    expect(otherPo.supersededDeletedPoLine).toBeUndefined();
    expect(otherContract.supersededDeletedPoLine).toBeUndefined();
    expect(deleted.supersededDeletedPoLine).toBe(true);
  });

  it('a blank Delete PO Status is not a deletion, and a line with only Delete STO Status is not deleted at PO level', () => {
    const blank = line('C1', 'P1', '   ');
    const stoOnly: DeletedPoLineCandidate = {
      contractNumber: 'C1',
      poNumber: 'P1',
      parsedData: { contract: { delete_sto_status: 'S' } },
    };
    const deleted = line('C1', 'P1', 'S');
    markSupersededDeletedPoLines([blank, stoOnly, deleted]);
    expect(blank.supersededDeletedPoLine).toBeUndefined();
    expect(stoOnly.supersededDeletedPoLine).toBeUndefined();
    expect(deleted.supersededDeletedPoLine).toBe(true);
  });

  it('reads the flag from any of contract, shipment or raw, as hasSapDeleteFlag does', () => {
    const viaRaw: DeletedPoLineCandidate = {
      contractNumber: 'C1',
      poNumber: 'P1',
      parsedData: { raw: { 'Delete PO Status': 'S' } },
    };
    const open = line('C1', 'P1');
    markSupersededDeletedPoLines([viaRaw, open]);
    expect(viaRaw.supersededDeletedPoLine).toBe(true);
  });

  it('ignores rows without a PO number', () => {
    const a = line('C1', null, 'S');
    const b = line('C1', null);
    expect(markSupersededDeletedPoLines([a, b])).toBe(0);
  });
});

/**
 * PO 1001032300 / contract 1004032300 (2026-10-20): two STO lines, STO 1006020464 open and STO 1006020263 with Delete STO Status "L", GR PO and GR STO
 * Open. KLIP read the L line like a Delete PO line and held the whole contract CANCELLED.
 */
describe('a Delete STO Status line does not cancel a PO that still has a live STO', () => {
  const stoLine = (po: string, sto: string, deleteSto?: string, deletePo?: string): DeletedPoLineCandidate => ({
    contractNumber: 'C1',
    poNumber: po,
    stoKey: sto,
    parsedData: {
      contract: {
        ...(deleteSto !== undefined ? { delete_sto_status: deleteSto } : {}),
        ...(deletePo !== undefined ? { delete_po_status: deletePo } : {}),
      },
    },
  });

  it('the case from SAP: the deleted STO is kept from cancelling the contract, whichever line comes first', () => {
    for (const order of [0, 1]) {
      const live = stoLine('P1', '1006020464');
      const deleted = stoLine('P1', '1006020263', 'L');
      const rows = order === 0 ? [live, deleted] : [deleted, live];
      expect(markStoDeletedWithLiveSibling(rows)).toEqual({ flagged: 1, setAside: 0 });
      expect(sapDeleteForcesContractCancel(deleted.parsedData)).toBe(false);
      expect(isStoDeletedWithLiveSibling(deleted.parsedData)).toBe(true);
      expect(sapDeleteForcesContractCancel(live.parsedData)).toBe(false);
      expect(deleted.supersededDeletedPoLine).toBeUndefined();
    }
  });

  it('without a live STO the line behaves as before: it cancels the contract', () => {
    const only = stoLine('P1', '1006020263', 'L');
    expect(markStoDeletedWithLiveSibling([only])).toEqual({ flagged: 0, setAside: 0 });
    expect(sapDeleteForcesContractCancel(only.parsedData)).toBe(true);
    const a = stoLine('P1', 'S1', 'L');
    const b = stoLine('P1', 'S2', 'S');
    expect(markStoDeletedWithLiveSibling([a, b])).toEqual({ flagged: 0, setAside: 0 });
    expect(sapDeleteForcesContractCancel(a.parsedData)).toBe(true);
    expect(sapDeleteForcesContractCancel(b.parsedData)).toBe(true);
  });

  it('a Delete PO Status line always cancels, live STO or not', () => {
    const live = stoLine('P1', 'S1');
    const poDeleted = stoLine('P1', 'S2', undefined, 'S');
    markStoDeletedWithLiveSibling([live, poDeleted]);
    expect(sapDeleteForcesContractCancel(poDeleted.parsedData)).toBe(true);
    expect(isStoDeletedWithLiveSibling(poDeleted.parsedData)).toBe(false);
  });

  it('a deleted line of the SAME STO as a live line is set aside, so it cannot overwrite it', () => {
    const live = stoLine('P1', 'S1');
    const deletedSame = stoLine('P1', 'S1', 'L');
    expect(markStoDeletedWithLiveSibling([live, deletedSame])).toEqual({ flagged: 0, setAside: 1 });
    expect(deletedSame.supersededDeletedPoLine).toBe(true);
  });

  it('a line already set aside as a deleted PO line is not counted again', () => {
    const live = stoLine('P1', 'S1');
    const poDeleted = stoLine('P1', 'S2', undefined, 'S');
    markSupersededDeletedPoLines([live, poDeleted]);
    expect(poDeleted.supersededDeletedPoLine).toBe(true);
    expect(markStoDeletedWithLiveSibling([live, poDeleted])).toEqual({ flagged: 0, setAside: 0 });
  });

  it('two POs in one file do not borrow the live STO of the other', () => {
    const liveOfP2 = stoLine('P2', 'S9');
    const deletedOfP1 = stoLine('P1', 'S1', 'L');
    markStoDeletedWithLiveSibling([liveOfP2, deletedOfP1]);
    expect(sapDeleteForcesContractCancel(deletedOfP1.parsedData)).toBe(true);
  });

  it('reads the flag from raw as well, and a line with no flag never cancels', () => {
    const viaRaw: DeletedPoLineCandidate = { contractNumber: 'C1', poNumber: 'P1', stoKey: 'S2', parsedData: { raw: { 'Delete STO Status': 'L' } } };
    const live = stoLine('P1', 'S1');
    markStoDeletedWithLiveSibling([live, viaRaw]);
    expect(isStoDeletedWithLiveSibling(viaRaw.parsedData)).toBe(true);
    expect(sapDeleteForcesContractCancel(live.parsedData)).toBe(false);
  });
});
