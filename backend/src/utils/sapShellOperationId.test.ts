import { describe, expect, it } from 'vitest';
import {
  ensureSapShellOperationId,
  isSapImportOperationIdSource,
  isSapStoShipmentId,
  SAP_IMPORT_OPERATION_ID_SOURCE,
} from './sapShellOperationId';

type Call = { text: string; params?: unknown[] };

/** A db whose answer depends on which statement it is asked. */
function fakeDb(answers: {
  row?: { shipment_id: string | null; operation_id: string | null } | null;
  sibling?: string | null;
  /** Operations the multi-PO-STO lookup finds (exactly one = adopt it). */
  planned?: string[];
  maxSeqPlusOne?: number;
  updated?: boolean;
  afterRace?: string | null;
}) {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      query: async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        if (/SELECT shipment_id, operation_id FROM shipments/.test(text)) return { rows: answers.row ? [answers.row] : [] };
        if (/FROM sap_processed_data/.test(text)) return { rows: (answers.planned ?? []).map((operation_id) => ({ operation_id })) };
        if (/WITH sto_rows AS/.test(text)) return { rows: [] };
        if (/FROM shipments sib/.test(text)) return { rows: answers.sibling ? [{ operation_id: answers.sibling }] : [] };
        if (/AS n/.test(text)) return { rows: [{ n: answers.maxSeqPlusOne ?? 1 }] };
        if (/UPDATE shipments/.test(text)) return { rows: answers.updated === false ? [] : [{ operation_id: params?.[1] }] };
        if (/SELECT operation_id FROM shipments WHERE id/.test(text)) return { rows: [{ operation_id: answers.afterRace ?? null }] };
        throw new Error(`unexpected statement: ${text.slice(0, 80)}`);
      },
    } as never,
  };
}

const NOW = new Date(2026, 9, 14, 11, 0, 0); // 14 Oct 2026

describe('ids and markers', () => {
  it('recognises the SAP_IMPORT marker only', () => {
    expect(isSapImportOperationIdSource('SAP_IMPORT')).toBe(true);
    expect(isSapImportOperationIdSource(' sap_import ')).toBe(true);
    expect(isSapImportOperationIdSource(null)).toBe(false);
    expect(isSapImportOperationIdSource('')).toBe(false);
    expect(isSapImportOperationIdSource('USER')).toBe(false);
  });

  it('only a digits shipment_id is a SAP STO shell', () => {
    expect(isSapStoShipmentId('1006018854')).toBe(true);
    expect(isSapStoShipmentId('MNL-1700-1004029379')).toBe(false);
    expect(isSapStoShipmentId('MSEA-abc')).toBe(false);
    expect(isSapStoShipmentId('')).toBe(false);
    expect(isSapStoShipmentId(null)).toBe(false);
  });
});

describe('ensureSapShellOperationId', () => {
  it('never changes an id that is already there (and writes nothing)', async () => {
    const { db, calls } = fakeDb({ row: { shipment_id: '1006018854', operation_id: 'OP-SEA-030920260454' } });
    expect(await ensureSapShellOperationId(db, 'uuid-1', NOW)).toBe('OP-SEA-030920260454');
    expect(calls.some((c) => /UPDATE/.test(c.text))).toBe(false);
  });

  it('leaves a KLIP manual row alone (MNL-/MSEA- ids are not SAP-imported)', async () => {
    const { db, calls } = fakeDb({ row: { shipment_id: 'MNL-1700-1004029379', operation_id: null } });
    expect(await ensureSapShellOperationId(db, 'uuid-1', NOW)).toBeNull();
    expect(calls.some((c) => /UPDATE/.test(c.text))).toBe(false);
  });

  it('returns null for a row that does not exist', async () => {
    const { db } = fakeDb({ row: null });
    expect(await ensureSapShellOperationId(db, 'uuid-1', NOW)).toBeNull();
  });

  it('adopts the id a sibling of the same STO carries, and marks it SAP_IMPORT', async () => {
    const { db, calls } = fakeDb({ row: { shipment_id: '1006019385', operation_id: null }, sibling: 'OP-SEA-130920260007' });
    expect(await ensureSapShellOperationId(db, 'uuid-1', NOW)).toBe('OP-SEA-130920260007');
    const update = calls.find((c) => /UPDATE shipments/.test(c.text))!;
    expect(update.params).toEqual(['uuid-1', 'OP-SEA-130920260007', SAP_IMPORT_OPERATION_ID_SOURCE]);
    // no sequence was allocated: the STO already has its id
    expect(calls.some((c) => /AS n/.test(c.text))).toBe(false);
  });

  it('allocates OP-SEA-DDMMYYYYnnnn from the daily sequence when no sibling has an id', async () => {
    const { db, calls } = fakeDb({ row: { shipment_id: '1006019385', operation_id: null }, sibling: null, maxSeqPlusOne: 12 });
    expect(await ensureSapShellOperationId(db, 'uuid-1', NOW)).toBe('OP-SEA-141020260012');
    expect(calls.find((c) => /AS n/.test(c.text))!.params).toEqual(['14102026', 'SEA']);
  });

  it('a sibling id is only adopted when no OTHER STO carries it (multi-STO operations are not borrowed)', async () => {
    const { db, calls } = fakeDb({ row: { shipment_id: '1006019385', operation_id: null }, sibling: null });
    await ensureSapShellOperationId(db, 'uuid-1', NOW);
    const siblingSql = calls.find((c) => /FROM shipments sib/.test(c.text))!.text;
    expect(siblingSql).toMatch(/other\.operation_id = sib\.operation_id AND other\.shipment_id IS DISTINCT FROM sib\.shipment_id/);
    // the plain number that equals the STO itself is the other adoptable convention
    expect(siblingSql).toMatch(/sib\.operation_id = sib\.shipment_id/);
  });

  it('a multi-PO STO takes the one voyage a user planned for exactly its POs (no sibling lookup, no new OP-SEA id)', async () => {
    const { db, calls } = fakeDb({ row: { shipment_id: '1006020666', operation_id: null }, planned: ['OP-1004032737-34122029'], sibling: 'OP-SEA-130920260007' });
    expect(await ensureSapShellOperationId(db, 'uuid-1', NOW)).toBe('OP-1004032737-34122029');
    const update = calls.find((c) => /UPDATE shipments/.test(c.text))!;
    expect(update.params).toEqual(['uuid-1', 'OP-1004032737-34122029', SAP_IMPORT_OPERATION_ID_SOURCE]);
    expect(calls.some((c) => /FROM shipments sib/.test(c.text))).toBe(false);
    expect(calls.some((c) => /AS n/.test(c.text))).toBe(false);
  });

  it('does not adopt when the lookup finds no voyage or more than one', async () => {
    const none = fakeDb({ row: { shipment_id: '1006020666', operation_id: null }, planned: [], maxSeqPlusOne: 3 });
    expect(await ensureSapShellOperationId(none.db, 'uuid-1', NOW)).toBe('OP-SEA-141020260003');
    const two = fakeDb({ row: { shipment_id: '1006020666', operation_id: null }, planned: ['OP-A-1', 'OP-B-2'], maxSeqPlusOne: 4 });
    expect(await ensureSapShellOperationId(two.db, 'uuid-1', NOW)).toBe('OP-SEA-141020260004');
  });

  it('after writing an id it pulls the STO\'s other SAP-assigned rows onto one operation', async () => {
    const { db, calls } = fakeDb({ row: { shipment_id: '1006019385', operation_id: null }, sibling: 'OP-SEA-130920260007' });
    await ensureSapShellOperationId(db, 'uuid-1', NOW);
    expect(calls.some((c) => /WITH sto_rows AS/.test(c.text))).toBe(true);
  });

  it('the write only fills an EMPTY operation_id (a user value set meanwhile wins)', async () => {
    const { db, calls } = fakeDb({
      row: { shipment_id: '1006019385', operation_id: null },
      sibling: null,
      updated: false,
      afterRace: 'OP-SEA-141020260099',
    });
    expect(await ensureSapShellOperationId(db, 'uuid-1', NOW)).toBe('OP-SEA-141020260099');
    expect(calls.find((c) => /UPDATE shipments/.test(c.text))!.text).toMatch(/NULLIF\(BTRIM\(operation_id\), ''\) IS NULL/);
  });
});
