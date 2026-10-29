import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyDocumentMoves,
  planDocumentMoves,
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
  operation_label: null,
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

describe('targetSubdirFor', () => {
  it('Contract / SI / BL of a shipment go to documents/shipment/<kind>/<shipment id>', () => {
    const r = (type: string) => targetSubdirFor(row({ id: '1', file_path: 'x', document_type: type, shipment_id: 'abc-123' }));
    expect(r('BL')).toEqual({ kind: 'shipment', subdir: 'documents/shipment/bl/abc-123' });
    expect(r('si')).toEqual({ kind: 'shipment', subdir: 'documents/shipment/si/abc-123' });
    expect(r('CONTRACT')).toEqual({ kind: 'shipment', subdir: 'documents/shipment/contract/abc-123' });
  });

  it('a document of a trucking operation goes to documents/trucking/<operation id>', () => {
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', trucking_operation_id: 'u', operation_label: 'OP-LAND-271020260001' }))).toEqual({
      kind: 'trucking',
      subdir: 'documents/trucking/OP-LAND-271020260001',
    });
  });

  it('SLD / SDD (nothing writes them any more), OTHER on a shipment, and an operation with no id are left alone', () => {
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', document_type: 'SLD', shipment_id: 's' }))).toBeNull();
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', document_type: 'SDD', shipment_id: 's' }))).toBeNull();
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', document_type: 'OTHER', shipment_id: 's' }))).toBeNull();
    expect(targetSubdirFor(row({ id: '1', file_path: 'x', trucking_operation_id: 'u', operation_label: null }))).toBeNull();
  });
});

describe('planDocumentMoves', () => {
  it('the cases seen on the Synology share: a renamed BL in the root, and a uuid-named trucking file in the root', () => {
    const bl = put('OP-1004031421-62102574-bl-261026-yohan.andrian.pdf');
    const tr = put('9bce466e_10.27_DO_CKG.pdf');
    const plans = planDocumentMoves([
      row({ id: 'a', file_path: path.relative(process.cwd(), bl), document_type: 'BL', shipment_id: 'abc-123' }),
      row({ id: 'b', file_path: path.relative(process.cwd(), tr), trucking_operation_id: 'u', operation_label: 'OP-LAND-271020260001' }),
    ]);
    expect(plans.map((p) => p.action)).toEqual(['move', 'move']);
    expect(plans[0].toAbs).toBe(path.join(root, 'documents', 'shipment', 'bl', 'abc-123', 'OP-1004031421-62102574-bl-261026-yohan.andrian.pdf'));
    expect(plans[1].toAbs).toBe(path.join(root, 'documents', 'trucking', 'OP-LAND-271020260001', '9bce466e_10.27_DO_CKG.pdf'));
  });

  it('a file already in its folder, a missing file and a taken target name are reported, never touched', () => {
    const ok = put('documents/shipment/si/s1/x-si.pdf');
    const taken = put('y-si.pdf');
    put('documents/shipment/si/s2/y-si.pdf', 'someone else');
    const plans = planDocumentMoves([
      row({ id: 'ok', file_path: ok, document_type: 'SI', shipment_id: 's1' }),
      row({ id: 'gone', file_path: path.join(root, 'nope.pdf'), document_type: 'SI', shipment_id: 's1' }),
      row({ id: 'taken', file_path: taken, document_type: 'SI', shipment_id: 's2' }),
      row({ id: 'none', file_path: ok, document_type: 'OTHER' }),
    ]);
    expect(plans.map((p) => p.action)).toEqual(['already_in_place', 'missing', 'collision', 'no_target']);
  });
});

describe('applyDocumentMoves', () => {
  it('moves the file, points file_path at it with a guard on the old value, and says what it did', async () => {
    const src = put('b-bl.pdf');
    const plans = planDocumentMoves([row({ id: 'a', file_path: src, document_type: 'BL', shipment_id: 's1' })]);
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

  it('when the update touches no row, the file goes back where it was', async () => {
    const src = put('c-bl.pdf');
    const plans = planDocumentMoves([row({ id: 'a', file_path: src, document_type: 'BL', shipment_id: 's1' })]);
    const out = await applyDocumentMoves(plans, { query: vi.fn().mockResolvedValue({ rowCount: 0 }) });
    expect(out.moved).toEqual([]);
    expect(out.failed[0].reason).toContain('file put back');
    expect(fs.existsSync(src)).toBe(true);
    expect(fs.existsSync(plans[0].toAbs as string)).toBe(false);
  });

  it('a database error also puts the file back, and the next row is still done', async () => {
    const a = put('d-bl.pdf');
    const b = put('e-bl.pdf');
    const plans = planDocumentMoves([
      row({ id: 'a', file_path: a, document_type: 'BL', shipment_id: 's1' }),
      row({ id: 'b', file_path: b, document_type: 'BL', shipment_id: 's1' }),
    ]);
    const query = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({ rowCount: 1 });
    const out = await applyDocumentMoves(plans, { query });
    expect(out.failed.map((f) => f.id)).toEqual(['a']);
    expect(out.moved.map((m) => m.id)).toEqual(['b']);
    expect(fs.existsSync(a)).toBe(true);
  });

  it('only rows planned as "move" are touched, and limit caps how many', async () => {
    const files = ['f1', 'f2', 'f3'].map((n) => put(`${n}-si.pdf`));
    const plans = planDocumentMoves(files.map((f, i) => row({ id: `r${i}`, file_path: f, document_type: 'SI', shipment_id: 's1' })));
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const out = await applyDocumentMoves(plans, { query }, { limit: 2 });
    expect(out.moved).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('rollbackSqlForMoves', () => {
  it('writes one guarded UPDATE per moved row, quoting what needs it', () => {
    expect(rollbackSqlForMoves([{ id: 'a', from: "uploads/o'x.pdf", to: 'uploads/documents/x.pdf' }])).toEqual([
      "UPDATE documents SET file_path = 'uploads/o''x.pdf' WHERE id = 'a' AND file_path = 'uploads/documents/x.pdf';",
    ]);
  });
});
