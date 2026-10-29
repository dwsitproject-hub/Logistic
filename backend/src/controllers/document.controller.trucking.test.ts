import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/clamScan.service', () => ({ scanFileWithClamdIfConfigured: vi.fn() }));

import { moveToTruckingFolder } from './document.controller';
import { buildTruckingDocumentUploadSubdir } from '../utils/fileUpload';

let root: string;
const env = { ...process.env };

function uploaded(name = 'abc_DO.pdf'): string {
  const p = path.join(root, name);
  fs.writeFileSync(p, '%PDF-1.4');
  return p;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-trucking-docs-'));
  process.env.UPLOAD_DIR = root;
  queryMock.mockReset();
});

afterEach(() => {
  process.env = { ...env };
  fs.rmSync(root, { recursive: true, force: true });
});

describe('buildTruckingDocumentUploadSubdir', () => {
  it('is documents/trucking/<subject>, beside documents/shipment', () => {
    expect(buildTruckingDocumentUploadSubdir('1001032563')).toBe('documents/trucking/1001032563');
  });

  it('keeps a path out of the subject (it comes from the database, but a folder name is never trusted)', () => {
    expect(buildTruckingDocumentUploadSubdir('../../etc')).toBe('documents/trucking/etc');
    expect(buildTruckingDocumentUploadSubdir('')).toBe('documents/trucking/unassigned');
  });
});

describe('moveToTruckingFolder: a Trucking upload is filed under documents/trucking', () => {
  it('an operation: documents/trucking/<PO number>/, the file moved there with its name', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ subject: '1001032563' }] });
    const file = uploaded();
    const moved = await moveToTruckingFolder(file, { truckingOperationId: 'uuid-op', contractId: 'uuid-c' });
    expect(moved).toBe(path.join(root, 'documents', 'trucking', '1001032563', 'abc_DO.pdf'));
    expect(fs.existsSync(moved as string)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('a contract with no operation (a backlog row): documents/trucking/<PO number>/', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ subject: '1001032563' }] });
    const moved = await moveToTruckingFolder(uploaded(), { contractId: 'uuid-c' });
    expect(moved).toBe(path.join(root, 'documents', 'trucking', '1001032563', 'abc_DO.pdf'));
  });

  it('an operation that cannot be found falls back to its contract', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ subject: '1001032563' }] });
    const moved = await moveToTruckingFolder(uploaded(), { truckingOperationId: 'gone', contractId: 'uuid-c' });
    expect(moved).toBe(path.join(root, 'documents', 'trucking', '1001032563', 'abc_DO.pdf'));
  });

  it('nothing to file it under: the file stays where it is and the upload is not failed', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const file = uploaded();
    expect(await moveToTruckingFolder(file, { truckingOperationId: 'gone' })).toBeNull();
    expect(fs.existsSync(file)).toBe(true);
  });

  it('a database error leaves the file in place too', async () => {
    queryMock.mockRejectedValue(new Error('db down'));
    const file = uploaded();
    expect(await moveToTruckingFolder(file, { truckingOperationId: 'x' })).toBeNull();
    expect(fs.existsSync(file)).toBe(true);
  });

  it('a file already in the right folder is left alone', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ subject: 'OP-1' }] });
    const dir = path.join(root, 'documents', 'trucking', 'OP-1');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'a.pdf');
    fs.writeFileSync(file, 'x');
    expect(await moveToTruckingFolder(file, { truckingOperationId: 'u' })).toBe(file);
    expect(fs.existsSync(file)).toBe(true);
  });
});
