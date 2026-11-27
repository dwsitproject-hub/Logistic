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
describe('uploadDocumentHandler: a shipment Contract / SI / BL is filed under documents/shipment/<kind>/<STO number> even when multer wrote it to the root', () => {
  it.each([
    ['BL', 'bl', 'bl'],
    ['SI', 'si', 'si'],
    ['CONTRACT', 'contract', 'ctr'],
  ])('%s', async (type, kind, token) => {
    const code = { ctr: 'Ctr', si: 'Si', bl: 'Bl' }[token as 'ctr' | 'si' | 'bl'];
    const written = path.join(root, 'b1c2_scan.pdf'); // where multer put it: the root
    fs.writeFileSync(written, '%PDF-1.4');
    queryMock
      .mockResolvedValueOnce({ rows: [{ operation_id: 'OP-1004031421-62102574', shipment_id: '1006020421', buyer: 'EOP Trading', folder_subject: '1006020421' }] }) // the shipment: buyer, STO key
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2], description: params[9] }] })); // INSERT
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
    const dir = path.join(root, 'documents', 'shipment', kind, '1006020421'); // the STO number, not the shipment id
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`EOP_${code}_1006020421.pdf`); // the Commercial Documents format: BUY_Code_<STO number>, no uploader or date in the name
    expect(fs.existsSync(written)).toBe(false);
    expect(out.body.data.file_path).toContain(`documents/shipment/${kind}/1006020421/`);
  });

  it('a shipment with no STO is filed under its operation id (the STO key falls through to it) and its file is named after its shipment id', async () => {
    const written = path.join(root, 'b1c2_si.pdf');
    fs.writeFileSync(written, '%PDF-1.4');
    queryMock
      .mockResolvedValueOnce({ rows: [{ operation_id: 'OP-1604000039-54225751', shipment_id: 'MNL-20261127-0001', buyer: null, supplier: 'Mega Sawit', folder_subject: 'OP-1604000039-54225751' }] })
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2], description: params[9] }] }));
    const out = res();
    await uploadDocumentHandler(
      { file: { path: written, originalname: 'si.pdf', size: 8, mimetype: 'application/pdf' }, body: { document_type: 'SI', shipment_id: 'abc-123' }, user: { username: 'a@b.c' } } as never,
      out as never,
    );
    // folder = operation id (the STO key), file name = shipment id; the buyer falls back to the supplier like COD's
    expect(fs.readdirSync(path.join(root, 'documents', 'shipment', 'si', 'OP-1604000039-54225751'))).toEqual(['MEG_Si_MNL-20261127-0001.pdf']);
  });

  it('a second Contract on the same STO becomes (2), like a COD version, and the first is kept', async () => {
    for (const n of [1, 2]) {
      const written = path.join(root, `b1c2_ctr${n}.pdf`);
      fs.writeFileSync(written, '%PDF-1.4');
      queryMock
        .mockResolvedValueOnce({ rows: [{ operation_id: 'OP-1', shipment_id: '1006020421', buyer: 'EOP Trading', folder_subject: '1006020421' }] })
        .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2], description: params[9] }] }));
      await uploadDocumentHandler(
        { file: { path: written, originalname: 'ctr.pdf', size: 8, mimetype: 'application/pdf' }, body: { document_type: 'CONTRACT', shipment_id: 'abc-123' } } as never,
        res() as never,
      );
    }
    expect(fs.readdirSync(path.join(root, 'documents', 'shipment', 'contract', '1006020421')).sort()).toEqual(['EOP_Ctr_1006020421(2).pdf', 'EOP_Ctr_1006020421.pdf']);
  });

  it('a shipment with no operation id is no longer refused: the name does not need one', async () => {
    const written = path.join(root, 'b1c2_bl2.pdf');
    fs.writeFileSync(written, '%PDF-1.4');
    queryMock
      .mockResolvedValueOnce({ rows: [{ operation_id: null, shipment_id: '1006020421', buyer: 'EOP', folder_subject: '1006020421' }] })
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2], description: params[9] }] }));
    const out = res();
    await uploadDocumentHandler(
      { file: { path: written, originalname: 'bl.pdf', size: 8, mimetype: 'application/pdf' }, body: { document_type: 'BL', shipment_id: 'abc-123' } } as never,
      out as never,
    );
    expect(out.statusCode).toBe(200);
  });

  it('a shipment whose key cannot be read keeps its id as the folder name', async () => {
    const written = path.join(root, 'b1c2_bl.pdf');
    fs.writeFileSync(written, '%PDF-1.4');
    queryMock
      .mockResolvedValueOnce({ rows: [{ operation_id: 'OP-1', folder_subject: null }] })
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2], description: params[9] }] }));
    const out = res();
    await uploadDocumentHandler(
      { file: { path: written, originalname: 'bl.pdf', size: 8, mimetype: 'application/pdf' }, body: { document_type: 'BL', shipment_id: 'abc-123' }, user: { username: 'a@b.c' } } as never,
      out as never,
    );
    expect(fs.readdirSync(path.join(root, 'documents', 'shipment', 'bl', 'abc-123'))).toHaveLength(1);
  });

  it('the INSERT records who uploaded (documents.uploaded_by), and NULL when no user is on the request', async () => {
    const insertParams: unknown[][] = [];
    queryMock.mockImplementation(async (_sql: string, params: unknown[]) => {
      if (String(_sql).includes('INSERT INTO documents')) {
        insertParams.push(params);
        return { rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2] }] };
      }
      return { rows: [] };
    });
    for (const [name, user] of [
      ['with.pdf', { id: 'user-uuid-1', username: 'a@b.c' }],
      ['without.pdf', undefined],
    ] as const) {
      const written = path.join(root, `b1c2_${name}`);
      fs.writeFileSync(written, 'x');
      await uploadDocumentHandler(
        { file: { path: written, originalname: name, size: 1, mimetype: 'application/pdf' }, body: { document_type: 'OTHER', contract_id: 'c-1' }, user } as never,
        res() as never,
      );
    }
    expect(insertParams).toHaveLength(2);
    expect(insertParams[0][10]).toBe('user-uuid-1');
    expect(insertParams[1][10]).toBeNull();
  });

  it.each([
    ['SLD', 'sld', 'Sld'],
    ['SDD', 'sdd', 'Sdd'],
    ['OTHER', 'other', 'Oth'],
  ])('Loading / Discharge / Others (%s) is filed under documents/shipment/%s/<STO number> and named like a COD file', async (type, kind, code) => {
    const written = path.join(root, 'b1c2_scan.pdf');
    fs.writeFileSync(written, 'x');
    queryMock
      .mockResolvedValueOnce({ rows: [{ operation_id: 'OP-1', shipment_id: '1006020421', buyer: 'EOP Trading', folder_subject: '1006020421' }] }) // the shipment folder lookup
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2], description: params[9] }] })); // INSERT
    const out = res();
    await uploadDocumentHandler(
      { file: { path: written, originalname: 'DOC LOADING BG Luminor 9.pdf', size: 1, mimetype: 'application/pdf' }, body: { document_type: type, shipment_id: 'abc-123' } } as never,
      out as never,
    );
    expect(out.statusCode).toBe(200);
    const dir = path.join(root, 'documents', 'shipment', kind, '1006020421');
    expect(fs.readdirSync(dir)).toEqual([`EOP_${code}_1006020421.pdf`]);
    // the name the user gave is kept in the description
    expect(out.body.data.description).toBe('original name: DOC LOADING BG Luminor 9.pdf');
    expect(fs.existsSync(written)).toBe(false);
    expect(out.body.data.file_path).toContain(`documents/shipment/${kind}/1006020421/`);
  });

  it('a second Others file on the same STO becomes (2), and the first is kept', async () => {
    for (const _ of [1, 2]) {
      const written = path.join(root, `b1c2_${_}.pdf`);
      fs.writeFileSync(written, 'x');
      queryMock
        .mockResolvedValueOnce({ rows: [{ operation_id: 'OP-1', shipment_id: '1006020421', buyer: 'EOP Trading', folder_subject: '1006020421' }] })
        .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2], description: params[9] }] }));
      await uploadDocumentHandler(
        { file: { path: written, originalname: 'survey.pdf', size: 1, mimetype: 'application/pdf' }, body: { document_type: 'OTHER', shipment_id: 'abc-123' } } as never,
        res() as never,
      );
    }
    expect(fs.readdirSync(path.join(root, 'documents', 'shipment', 'other', '1006020421')).sort()).toEqual(['EOP_Oth_1006020421(2).pdf', 'EOP_Oth_1006020421.pdf']);
  });

  it('an OTHER upload for a shipment that cannot be found is not refused (the Shipments Docs dialog has always uploaded these): the file stays where it was written', async () => {
    const written = path.join(root, 'b1c2_other.pdf');
    fs.writeFileSync(written, 'x');
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // no such shipment
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2], description: params[9] }] }));
    const out = res();
    await uploadDocumentHandler(
      { file: { path: written, originalname: 'other.pdf', size: 1, mimetype: 'application/pdf' }, body: { document_type: 'OTHER', shipment_id: 'abc-123' } } as never,
      out as never,
    );
    expect(out.statusCode).toBe(200);
    expect(fs.existsSync(written)).toBe(true);
  });

  it('an OTHER upload with no shipment (a contract or payment document) is not filed under a shipment', async () => {
    const written = path.join(root, 'b1c2_contract.pdf');
    fs.writeFileSync(written, 'x');
    queryMock.mockImplementationOnce(async (_sql: string, params: unknown[]) => ({ rows: [{ id: 'doc-1', file_name: params[1], file_path: params[2], description: params[9] }] }));
    const out = res();
    await uploadDocumentHandler(
      { file: { path: written, originalname: 'contract.pdf', size: 1, mimetype: 'application/pdf' }, body: { document_type: 'OTHER', contract_id: 'c-1' } } as never,
      out as never,
    );
    expect(out.statusCode).toBe(200);
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.existsSync(path.join(root, 'documents', 'shipment'))).toBe(false);
  });
});
