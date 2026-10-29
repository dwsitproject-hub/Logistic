import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPathUpdates,
  moveCommercialDocsTree,
  planPathUpdates,
  rollbackSqlForPathUpdates,
  toNewCommercialDocsStoredPath,
} from './commercialDocsFolderRename.service';
import { commercialDocsAlternates, resolveUploadAbsolutePath } from '../utils/fileUpload';

let root: string;
const env = { ...process.env };

function put(rel: string, content = '%PDF-1.4'): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-cd-rename-'));
  process.env.UPLOAD_DIR = root;
});

afterEach(() => {
  process.env = { ...env };
  fs.rmSync(root, { recursive: true, force: true });
});

describe('toNewCommercialDocsStoredPath', () => {
  it('changes the folder name inside a stored path, and nothing else', () => {
    expect(toNewCommercialDocsStoredPath('uploads/COMMERCIAL DOCS/2026/10/1381002868/EU-CTR.pdf')).toBe('uploads/commercial-docs/2026/10/1381002868/EU-CTR.pdf');
    expect(toNewCommercialDocsStoredPath('COMMERCIAL DOCS/2026/09/x.pdf')).toBe('commercial-docs/2026/09/x.pdf');
    expect(toNewCommercialDocsStoredPath('/app/uploads/commercial docs/2026/10/x.pdf')).toBe('/app/uploads/commercial-docs/2026/10/x.pdf');
  });

  it('a path that is not under the old folder says null', () => {
    expect(toNewCommercialDocsStoredPath('uploads/commercial-docs/2026/10/x.pdf')).toBeNull();
    expect(toNewCommercialDocsStoredPath('uploads/commercial-documents/1381002868/x.pdf')).toBeNull();
    expect(toNewCommercialDocsStoredPath('uploads/documents/shipment/bl/1/COMMERCIAL DOCS.pdf')).toBeNull();
  });
});

describe('a stored path finds its file under either spelling of the folder', () => {
  it('alternates go both ways', () => {
    expect(commercialDocsAlternates('/app/uploads/COMMERCIAL DOCS/2026/10/p/f.pdf')).toEqual(['/app/uploads/commercial-docs/2026/10/p/f.pdf']);
    expect(commercialDocsAlternates('/app/uploads/commercial-docs/2026/10/p/f.pdf')).toEqual(['/app/uploads/COMMERCIAL DOCS/2026/10/p/f.pdf']);
    expect(commercialDocsAlternates('/app/uploads/documents/x.pdf')).toEqual([]);
  });

  it('the file is at the new place but the row still says the old one (the window between the move and the update): found', () => {
    const real = put('commercial-docs/2026/10/p/f.pdf');
    expect(resolveUploadAbsolutePath(path.join(root, 'COMMERCIAL DOCS', '2026', '10', 'p', 'f.pdf'))).toBe(real);
  });

  it('the file is at the old place but the row already says the new one (a rollback): found', () => {
    const real = put('COMMERCIAL DOCS/2026/10/p/f.pdf');
    expect(resolveUploadAbsolutePath(path.join(root, 'commercial-docs', '2026', '10', 'p', 'f.pdf'))).toBe(real);
  });

  it('a path that exists as stored is returned as it is, and a missing one stays missing', () => {
    const here = put('commercial-docs/a.pdf');
    expect(resolveUploadAbsolutePath(here)).toBe(here);
    const gone = path.join(root, 'COMMERCIAL DOCS', 'nope.pdf');
    expect(resolveUploadAbsolutePath(gone)).toBe(gone);
  });
});

describe('moveCommercialDocsTree', () => {
  it('commercial-docs does not exist yet: the folder is renamed in one step', () => {
    put('COMMERCIAL DOCS/2026/10/p1/a.pdf');
    put('COMMERCIAL DOCS/2026/09/p2/b.pdf');
    const out = moveCommercialDocsTree(root);
    expect(out.renamedWhole).toBe(true);
    expect(fs.existsSync(path.join(root, 'COMMERCIAL DOCS'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'commercial-docs', '2026', '10', 'p1', 'a.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'commercial-docs', '2026', '09', 'p2', 'b.pdf'))).toBe(true);
  });

  it('commercial-docs already exists (new uploads went there first): the two are merged, nothing overwritten, the old folder removed', () => {
    put('COMMERCIAL DOCS/2026/10/p1/a.pdf', 'old a');
    put('COMMERCIAL DOCS/2026/09/p2/b.pdf', 'old b');
    put('commercial-docs/2026/10/p1/new.pdf', 'new');
    const out = moveCommercialDocsTree(root);
    expect(out.renamedWhole).toBe(false);
    expect(out.moved).toBe(2);
    expect(out.collisions).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'commercial-docs', '2026', '10', 'p1', 'a.pdf'), 'utf8')).toBe('old a');
    expect(fs.readFileSync(path.join(root, 'commercial-docs', '2026', '10', 'p1', 'new.pdf'), 'utf8')).toBe('new');
    expect(fs.existsSync(path.join(root, 'COMMERCIAL DOCS'))).toBe(false);
  });

  it('a name already taken in the new folder is left behind and reported, never overwritten', () => {
    put('COMMERCIAL DOCS/2026/10/p1/same.pdf', 'old');
    put('COMMERCIAL DOCS/2026/10/p1/other.pdf', 'other');
    put('commercial-docs/2026/10/p1/same.pdf', 'new');
    const out = moveCommercialDocsTree(root);
    expect(out.collisions).toEqual(['2026/10/p1/same.pdf']);
    expect(fs.readFileSync(path.join(root, 'commercial-docs', '2026', '10', 'p1', 'same.pdf'), 'utf8')).toBe('new');
    expect(fs.readFileSync(path.join(root, 'COMMERCIAL DOCS', '2026', '10', 'p1', 'same.pdf'), 'utf8')).toBe('old');
    expect(fs.existsSync(path.join(root, 'commercial-docs', '2026', '10', 'p1', 'other.pdf'))).toBe(true);
  });

  it('no old folder: nothing to do', () => {
    expect(moveCommercialDocsTree(root).nothing).toBe(true);
  });
});

describe('planPathUpdates and applyPathUpdates', () => {
  const rows = [
    { id: '1', file_path: 'uploads/COMMERCIAL DOCS/2026/10/p/a.pdf' },
    { id: '2', file_path: 'uploads/COMMERCIAL DOCS/2026/10/p/gone.pdf' },
    { id: '3', file_path: 'uploads/commercial-docs/2026/10/p/already.pdf' },
  ];

  it('only a row whose file really is at its new place is rewritten; the rest are listed', () => {
    const { updates, missing } = planPathUpdates('commercial_document_files', rows, (p) => p.endsWith('a.pdf'));
    expect(updates).toEqual([{ table: 'commercial_document_files', id: '1', from: rows[0].file_path, to: 'uploads/commercial-docs/2026/10/p/a.pdf' }]);
    expect(missing.map((m) => m.id)).toEqual(['2']);
  });

  it('writes in one transaction, each with a guard on the old value', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const changed = await applyPathUpdates({ query }, [{ table: 't', id: '1', from: 'a', to: 'b' }]);
    expect(changed).toBe(1);
    expect(query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'UPDATE t SET file_path = $2 WHERE id = $1 AND file_path = $3', 'COMMIT']);
  });

  it('a row that changed meanwhile rolls EVERYTHING back', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValue({});
    await expect(
      applyPathUpdates({ query }, [
        { table: 't', id: '1', from: 'a', to: 'b' },
        { table: 't', id: '2', from: 'c', to: 'd' },
      ]),
    ).rejects.toThrow('changed meanwhile');
    expect(query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
    expect(query.mock.calls.map((c) => c[0])).not.toContain('COMMIT');
  });

  it('the rollback SQL puts each path back, guarded', () => {
    expect(rollbackSqlForPathUpdates([{ table: 't', id: '1', from: "o'a", to: 'b' }])).toEqual(["UPDATE t SET file_path = 'o''a' WHERE id = '1' AND file_path = 'b';"]);
  });
});
