import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyDocumentMoves,
  planDocumentMoves,
  removeIfEmptySubjectFolder,
  rollbackSqlForMoves,
  targetSubdirFor,
  type DocumentRow,
} from './documentFolderMigration.service';

let root: string;
const env = { ...process.env };

const row = (over: Partial<DocumentRow> & Pick<DocumentRow, 'id' | 'file_path'>): DocumentRow => ({
  document_type: 'OTHER',
  file_name: null,
  shipment_id: null,
  trucking_operation_id: null,
  shipment_folder: null,
  trucking_folder: null,
  ...over,
});

function put(rel: string, content = '%PDF-1.4'): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-migrate-docs-'));
  process.env.UPLOAD_DIR = root;
});

afterEach(() => {
  process.env = { ...env };
  fs.rmSync(root, { recursive: true, force: true });
});

describe('targetSubdirFor: the folder is named after the STO and the PO, not after a database id', () => {
  it('Contract / SI / BL of a shipment go to documents/shipment/<kind>/<STO number>', () => {
    const r = (type: string) => targetSubdirFor(row({ id: '1', file_path: 'x', document_type: type, shipment_id: 'uuid-1', shipment_folder: '1006020421' }));
    expect(r('BL')).toEqual({ kind: 'shipment', subdir: 'documents/shipment/bl/1006020421' });
    expect(r('si')).toEqual({ kind: 'shipment', subdir: 'documents/shipment/si/1006020421' });
    expect(r('CONTRACT')).toEqual({ kind: 'shipment', subdir: 'documents/shipment/contract/1006020421' });
  });

  it('a shipment with no STO is filed under its operation id (that is what its key falls through to)', () => {
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', document_type: 'BL', shipment_id: 'uuid-1', shipment_folder: 'OP-1604000039-54225751' }))).toEqual({
      kind: 'shipment',
      subdir: 'documents/shipment/bl/OP-1604000039-54225751',
    });
  });

  it('a shipment row that is gone keeps its id as the only name left', () => {
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', document_type: 'BL', shipment_id: 'abc-123', shipment_folder: null }))).toEqual({
      kind: 'shipment',
      subdir: 'documents/shipment/bl/abc-123',
    });
  });

  it('a document of a trucking operation goes to documents/trucking/<PO number>', () => {
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', trucking_operation_id: 'u', trucking_folder: '1001032563' }))).toEqual({
      kind: 'trucking',
      subdir: 'documents/trucking/1001032563',
    });
  });

  it('SLD / SDD (nothing writes them any more), OTHER on a shipment, and an operation with nothing to name it by are left alone', () => {
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', document_type: 'SLD', shipment_id: 's' }))).toBeNull();
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', document_type: 'SDD', shipment_id: 's' }))).toBeNull();
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', document_type: 'OTHER', shipment_id: 's' }))).toBeNull();
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', trucking_operation_id: 'u', trucking_folder: null }))).toBeNull();
  });
});

describe('planDocumentMoves', () => {
  it('the cases seen on the Synology share: a renamed BL in the root, and a uuid-named trucking file in the root', () => {
    const bl = put('OP-1004031421-62102574-bl-261026-yohan.andrian.pdf');
    const tr = put('9bce466e_10.27_DO_CKG.pdf');
    const plans = planDocumentMoves([
      row({ id: 'a', file_path: path.relative(process.cwd(), bl), document_type: 'BL', shipment_id: 'uuid-1', shipment_folder: '1006020421' }),
      row({ id: 'b', file_path: path.relative(process.cwd(), tr), trucking_operation_id: 'u', trucking_folder: '1001032563' }),
    ]);
    expect(plans.map((p) => p.action)).toEqual(['move', 'move']);
    expect(plans[0].toAbs).toBe(path.join(root, 'documents', 'shipment', 'bl', '1006020421', 'OP-1004031421-62102574-bl-261026-yohan.andrian.pdf'));
    expect(plans[1].toAbs).toBe(path.join(root, 'documents', 'trucking', '1001032563', '9bce466e_10.27_DO_CKG.pdf'));
  });

  it('running it again moves what the first version filed under a uuid / operation id to the STO / PO name', () => {
    const old = put('documents/shipment/bl/9d6f64fb-bff6-43f0-ad7b-25781640eba6/OP-1-bl-261026-u.pdf');
    const oldTr = put('documents/trucking/OP-LAND-271020260001/9bce_DO.pdf');
    const plans = planDocumentMoves([
      row({ id: 'a', file_path: old, document_type: 'BL', shipment_id: '9d6f64fb-bff6-43f0-ad7b-25781640eba6', shipment_folder: '1006020421' }),
      row({ id: 'b', file_path: oldTr, trucking_operation_id: 'u', trucking_folder: '1001032563' }),
    ]);
    expect(plans.map((p) => p.action)).toEqual(['move', 'move']);
    expect(plans[0].toAbs).toBe(path.join(root, 'documents', 'shipment', 'bl', '1006020421', 'OP-1-bl-261026-u.pdf'));
  });

  it('a shipment that has since been given an STO moves from its operation-id folder to its STO folder', () => {
    const f = put('documents/shipment/si/OP-SEA-1/x-si.pdf');
    const [plan] = planDocumentMoves([row({ id: 'a', file_path: f, document_type: 'SI', shipment_id: 's1', shipment_folder: '1006020999' })]);
    expect(plan.action).toBe('move');
    expect(plan.toAbs).toBe(path.join(root, 'documents', 'shipment', 'si', '1006020999', 'x-si.pdf'));
  });

  it('a file already in its folder, a missing file and a taken target name are reported, never touched', () => {
    const ok = put('documents/shipment/si/1006020421/x-si.pdf');
    const taken = put('y-si.pdf');
    put('documents/shipment/si/1006020999/y-si.pdf', 'someone else');
    const plans = planDocumentMoves([
      row({ id: 'ok', file_path: ok, document_type: 'SI', shipment_id: 's1', shipment_folder: '1006020421' }),
      row({ id: 'gone', file_path: path.join(root, 'nope.pdf'), document_type: 'SI', shipment_id: 's1', shipment_folder: '1006020421' }),
      row({ id: 'taken', file_path: taken, document_type: 'SI', shipment_id: 's2', shipment_folder: '1006020999' }),
      row({ id: 'none', file_path: ok, document_type: 'OTHER' }),
    ]);
    expect(plans.map((p) => p.action)).toEqual(['already_in_place', 'missing', 'collision', 'no_target']);
  });

  it('two rows of different folders that meet in one STO folder with the same file name: the first moves, the second waits for a person', () => {
    const a = put('documents/shipment/bl/aaa/same-bl.pdf', 'one');
    const b = put('documents/shipment/bl/bbb/same-bl.pdf', 'two');
    const plans = planDocumentMoves([
      row({ id: 'a', file_path: a, document_type: 'BL', shipment_id: 'aaa', shipment_folder: '1006020421' }),
      row({ id: 'b', file_path: b, document_type: 'BL', shipment_id: 'bbb', shipment_folder: '1006020421' }),
    ]);
    expect(plans.map((p) => p.action)).toEqual(['move', 'collision']);
  });
});

describe('applyDocumentMoves', () => {
  it('moves the file, points file_path at it with a guard on the old value, and says what it did', async () => {
    const src = put('b-bl.pdf');
    const plans = planDocumentMoves([row({ id: 'a', file_path: src, document_type: 'BL', shipment_id: 's1', shipment_folder: '1006020421' })]);
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const out = await applyDocumentMoves(plans, { query });
    expect(out.failed).toEqual([]);
    expect(out.moved).toHaveLength(1);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.existsSync(plans[0].toAbs as string)).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND file_path = $3');
    expect(params).toEqual(['a', plans[0].toStored, src]);
  });

  it('the folder a file was moved out of is removed when it was a subject folder and is now empty', async () => {
    const src = put('documents/shipment/bl/9d6f64fb-uuid/OP-1-bl.pdf');
    const plans = planDocumentMoves([row({ id: 'a', file_path: src, document_type: 'BL', shipment_id: '9d6f64fb-uuid', shipment_folder: '1006020421' })]);
    await applyDocumentMoves(plans, { query: vi.fn().mockResolvedValue({ rowCount: 1 }) });
    expect(fs.existsSync(path.join(root, 'documents', 'shipment', 'bl', '9d6f64fb-uuid'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'documents', 'shipment', 'bl', '1006020421', 'OP-1-bl.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'documents', 'shipment', 'bl'))).toBe(true); // the <kind> folder is the share's structure
  });

  it('a folder that still holds something is kept', async () => {
    const a = put('documents/shipment/bl/aaa/one-bl.pdf');
    put('documents/shipment/bl/aaa/two-bl.pdf');
    const plans = planDocumentMoves([row({ id: 'a', file_path: a, document_type: 'BL', shipment_id: 'aaa', shipment_folder: '1006020421' })]);
    await applyDocumentMoves(plans, { query: vi.fn().mockResolvedValue({ rowCount: 1 }) });
    expect(fs.existsSync(path.join(root, 'documents', 'shipment', 'bl', 'aaa', 'two-bl.pdf'))).toBe(true);
  });

  it('a target that appeared after the plan was made is refused, never overwritten', async () => {
    const src = put('c-bl.pdf', 'mine');
    const plans = planDocumentMoves([row({ id: 'a', file_path: src, document_type: 'BL', shipment_id: 's1', shipment_folder: '1006020421' })]);
    fs.mkdirSync(path.dirname(plans[0].toAbs as string), { recursive: true });
    fs.writeFileSync(plans[0].toAbs as string, 'theirs');
    const query = vi.fn();
    const out = await applyDocumentMoves(plans, { query });
    expect(out.failed[0].reason).toContain('target already exists');
    expect(query).not.toHaveBeenCalled();
    expect(fs.readFileSync(plans[0].toAbs as string, 'utf8')).toBe('theirs');
    expect(fs.readFileSync(src, 'utf8')).toBe('mine');
  });

  it('when the update touches no row, the file goes back where it was', async () => {
    const src = put('d-bl.pdf');
    const plans = planDocumentMoves([row({ id: 'a', file_path: src, document_type: 'BL', shipment_id: 's1', shipment_folder: '1006020421' })]);
    const out = await applyDocumentMoves(plans, { query: vi.fn().mockResolvedValue({ rowCount: 0 }) });
    expect(out.moved).toEqual([]);
    expect(out.failed[0].reason).toContain('file put back');
    expect(fs.existsSync(src)).toBe(true);
    expect(fs.existsSync(plans[0].toAbs as string)).toBe(false);
  });

  it('a database error also puts the file back, and the next row is still done', async () => {
    const a = put('e-bl.pdf');
    const b = put('f-bl.pdf');
    const plans = planDocumentMoves([
      row({ id: 'a', file_path: a, document_type: 'BL', shipment_id: 's1', shipment_folder: '1006020421' }),
      row({ id: 'b', file_path: b, document_type: 'BL', shipment_id: 's1', shipment_folder: '1006020421' }),
    ]);
    const query = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({ rowCount: 1 });
    const out = await applyDocumentMoves(plans, { query });
    expect(out.failed.map((f) => f.id)).toEqual(['a']);
    expect(out.moved.map((m) => m.id)).toEqual(['b']);
    expect(fs.existsSync(a)).toBe(true);
  });

  it('only rows planned as "move" are touched, and limit caps how many', async () => {
    const files = ['g1', 'g2', 'g3'].map((n) => put(`${n}-si.pdf`));
    const plans = planDocumentMoves(files.map((f, i) => row({ id: `r${i}`, file_path: f, document_type: 'SI', shipment_id: 's1', shipment_folder: '1006020421' })));
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const out = await applyDocumentMoves(plans, { query }, { limit: 2 });
    expect(out.moved).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('removeIfEmptySubjectFolder', () => {
  it('only a subject folder: never the upload root, documents, shipment, a <kind> folder or documents/trucking', () => {
    for (const rel of ['', 'documents', 'documents/shipment', 'documents/shipment/bl', 'documents/trucking']) {
      const dir = path.join(root, rel);
      fs.mkdirSync(dir, { recursive: true });
      expect(removeIfEmptySubjectFolder(dir)).toBe(false);
      expect(fs.existsSync(dir)).toBe(true);
    }
    const subject = path.join(root, 'documents', 'trucking', '1001032563');
    fs.mkdirSync(subject, { recursive: true });
    expect(removeIfEmptySubjectFolder(subject)).toBe(true);
    expect(fs.existsSync(subject)).toBe(false);
  });

  it('a folder outside the upload root is not touched', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-outside-'));
    expect(removeIfEmptySubjectFolder(outside)).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe('rollbackSqlForMoves', () => {
  it('writes one guarded UPDATE per moved row, quoting what needs it', () => {
    expect(rollbackSqlForMoves([{ id: 'a', from: "uploads/o'x.pdf", to: 'uploads/documents/x.pdf' }])).toEqual([
      "UPDATE documents SET file_path = 'uploads/o''x.pdf' WHERE id = 'a' AND file_path = 'uploads/documents/x.pdf';",
    ]);
  });
});
