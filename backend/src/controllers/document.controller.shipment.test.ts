import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/clamScan.service', () => ({ scanFileWithClamdIfConfigured: vi.fn().mockResolvedValue({ skipped: true, clean: true }) }));

import { uploadDocumentHandler } from './document.controller';

let root: string;
const env = { ...process.env };

function res() {
  const r: { body?: any; statusCode: number; json: (b: unknown) => unknown; status: (c: number) => unknown } = {
    statusCode: 200,
    json(b) {
      r.body = b;
      return r;
    },
    status(c) {
      r.statusCode = c;
      return r;
    },
  };
  return r;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-shipment-docs-'));
  process.env.UPLOAD_DIR = root;
  queryMock.mockReset();
});

afterEach(() => {
  process.env = { ...env };
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Found 2026-10-29: Contract / SI / BL files renamed to OP-...-bl-261026-user were sitting loose in the root of the Synology share. Every client appends `file`
 * BEFORE document_type and shipment_id, so multer's destination callback saw an empty body and wrote to the upload root; the rename then happened in that same folder.
 */
describe('uploadDocumentHandler: a shipment Contract / SI / BL is filed under documents/shipment/<kind>/<id> even when multer wrote it to the root', () => {
  it.each([
    ['BL', 'bl', 'bl'],
    ['SI', 'si', 'si'],
    ['CONTRACT', 'contract', 'ctr'],
  ])('%s', async (type, kind, token) => {
    const written = path.join(root, 'b1c2_scan.pdf'); // where multer put it: the root
    fs.writeFileSync(written, '%PDF-1.4');
    queryMock
      .mockResolvedValueOnce({ rows: [{ operation_id: 'OP-1004031421-62102574' }] }) // SELECT operation_id FROM shipments
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2] }] })); // INSERT
    const out = res();
    await uploadDocumentHandler(
      {
        file: { path: written, originalname: 'scan.pdf', size: 8, mimetype: 'application/pdf' },
        body: { document_type: type, shipment_id: 'abc-123' },
        user: { username: 'yohan.andrian@energi-up.com' },
      } as never,
      out as never,
    );
    expect(out.statusCode).toBe(200);
    const dir = path.join(root, 'documents', 'shipment', kind, 'abc-123');
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(new RegExp(`^OP-1004031421-62102574-${token}-\\d{6}-yohan\\.andrian\\.pdf$`));
    expect(fs.existsSync(written)).toBe(false);
    expect(out.body.data.file_path).toContain(`documents/shipment/${kind}/abc-123/`);
  });

  it('a type that has no structured folder (OTHER) stays where multer wrote it', async () => {
    const written = path.join(root, 'b1c2_other.pdf');
    fs.writeFileSync(written, 'x');
    queryMock.mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2] }] }));
    const out = res();
    await uploadDocumentHandler(
      { file: { path: written, originalname: 'other.pdf', size: 1, mimetype: 'application/pdf' }, body: { document_type: 'OTHER', shipment_id: 'abc-123' } } as never,
      out as never,
    );
    expect(out.statusCode).toBe(200);
    expect(fs.existsSync(written)).toBe(true);
  });
});
