import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/clamScan.service', () => ({ scanFileWithClamdIfConfigured: vi.fn() }));

import { documentViewOrigins, inlineMimeType, viewDocument } from './document.controller';
import { jpsDocumentViewUrl } from '../jps/config';

let root: string;
const env = { ...process.env };

function fakeRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    headers,
    body: undefined,
    downloaded: undefined,
    sent: undefined,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
      return res;
    },
    removeHeader(k: string) {
      delete headers[k.toLowerCase()];
    },
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
    download(p: string, n: string) {
      res.downloaded = { p, n };
      return res;
    },
    sendFile(p: string, o: unknown) {
      res.sent = { p, o };
      return res;
    },
  };
  return res;
}

const req = (id: string, origin?: string) => ({ params: { id }, headers: origin ? { origin } : {} }) as never;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-view-'));
  process.env.UPLOAD_DIR = root;
  process.env.DOCUMENT_VIEW_ORIGINS = 'http://jps-app.example:3080/, https://other.example';
  queryMock.mockReset();
});

afterEach(() => {
  process.env = { ...env };
  fs.rmSync(root, { recursive: true, force: true });
});

describe('what a browser can show', () => {
  it('PDF, PNG and JPEG by the stored type, or by the extension when the type says nothing', () => {
    expect(inlineMimeType('a.bin', 'application/pdf')).toBe('application/pdf');
    expect(inlineMimeType('OP-1-bl-261026-yohan.andrian.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(inlineMimeType('a.PNG', null)).toBe('image/png');
    expect(inlineMimeType('a.jpeg', '')).toBe('image/jpeg');
    expect(inlineMimeType('sheet.xlsx', 'application/vnd.ms-excel')).toBeNull();
  });
});

describe('documentViewOrigins: who may frame or read a document', () => {
  it("JPS's own origin and DOCUMENT_VIEW_ORIGINS, as origins, without duplicates, and nothing that is not http(s)", () => {
    expect(
      documentViewOrigins(
        { DOCUMENT_VIEW_ORIGINS: 'http://jps-app.example:3080/, https://other.example, ftp://x, nonsense, http://172.28.92.56:3080' } as never,
        'http://172.28.92.56:3080/api/v1',
      ),
    ).toEqual(['http://172.28.92.56:3080', 'http://jps-app.example:3080', 'https://other.example']);
    expect(documentViewOrigins({} as never, '')).toEqual([]);
  });
});

describe('viewDocument: JPS shows the Contract / SI / BL links KLIP sends it', () => {
  function row(over: Record<string, unknown> = {}) {
    const abs = path.join(root, 'documents', 'shipment', 'bl', '1006020421', 'OP-1-bl-261026-yohan.andrian.pdf');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '%PDF-1.4');
    return { id: 'd1', file_name: 'OP-1-bl-261026-yohan.andrian.pdf', mime_type: 'application/octet-stream', file_path: abs, ...over };
  }

  it('answers INLINE with the real type, where /download answers attachment', async () => {
    queryMock.mockResolvedValue({ rows: [row()] });
    const res = fakeRes();
    await viewDocument(req('d1'), res);
    expect(res.headers['content-disposition']).toMatch(/^inline; filename\*=UTF-8''OP-1-bl-261026-yohan\.andrian\.pdf$/);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.sent.p).toContain('OP-1-bl-261026-yohan.andrian.pdf');
    expect(res.downloaded).toBeUndefined();
  });

  it("lets the JPS origins frame it: frame-ancestors, no X-Frame-Options (helmet's SAMEORIGIN), CORP cross-origin", async () => {
    queryMock.mockResolvedValue({ rows: [row()] });
    const res = fakeRes();
    res.headers['x-frame-options'] = 'SAMEORIGIN'; // what helmet set before the handler
    await viewDocument(req('d1'), res);
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self' http://jps-app.example:3080 https://other.example");
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS only for an origin on the list', async () => {
    queryMock.mockResolvedValue({ rows: [row()] });
    const ok = fakeRes();
    await viewDocument(req('d1', 'http://jps-app.example:3080'), ok);
    expect(ok.headers['access-control-allow-origin']).toBe('http://jps-app.example:3080');
    expect(ok.headers['vary']).toBe('Origin');
    const no = fakeRes();
    await viewDocument(req('d1', 'http://evil.example'), no);
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('a file name with a space or a bracket is encoded in the header', async () => {
    queryMock.mockResolvedValue({ rows: [row({ file_name: '10.27 DO CKG (1000 mt).pdf' })] });
    const res = fakeRes();
    await viewDocument(req('d1'), res);
    expect(res.headers['content-disposition']).toBe("inline; filename*=UTF-8''10.27%20DO%20CKG%20(1000%20mt).pdf");
  });

  it('a type a browser cannot show is sent as a download, as /download does', async () => {
    queryMock.mockResolvedValue({ rows: [row({ file_name: 'sheet.xlsx', mime_type: 'application/vnd.ms-excel' })] });
    const res = fakeRes();
    await viewDocument(req('d1'), res);
    expect(res.downloaded).toBeDefined();
    expect(res.sent).toBeUndefined();
  });

  it("unknown id, and a file that is not on the share, are 404 with the API's message", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const a = fakeRes();
    await viewDocument(req('nope'), a);
    expect(a.statusCode).toBe(404);
    expect(a.body.error.message).toBe('Document not found');
    queryMock.mockResolvedValue({ rows: [{ id: 'd', file_name: 'a.pdf', mime_type: 'application/pdf', file_path: path.join(root, 'gone.pdf') }] });
    const b = fakeRes();
    await viewDocument(req('d'), b);
    expect(b.statusCode).toBe(404);
    expect(b.body.error.message).toBe('File not found on server');
  });

  it('a file filed under the OLD Commercial Documents spelling is still found (the stored path goes through the same resolver as /download)', async () => {
    const real = path.join(root, 'commercial-docs', '2026', '10', 'p', 'a.pdf');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, '%PDF');
    queryMock.mockResolvedValue({ rows: [{ id: 'd', file_name: 'a.pdf', mime_type: 'application/pdf', file_path: path.join(root, 'COMMERCIAL DOCS', '2026', '10', 'p', 'a.pdf') }] });
    const res = fakeRes();
    await viewDocument(req('d'), res);
    expect(res.sent.p).toBe(real);
  });
});

describe('jpsDocumentViewUrl: the link JPS gets', () => {
  const previous = process.env.APP_PUBLIC_ORIGIN;
  afterEach(() => {
    if (previous === undefined) delete process.env.APP_PUBLIC_ORIGIN;
    else process.env.APP_PUBLIC_ORIGIN = previous;
  });

  it('is the open VIEW route of the same origin; no id, or no origin, no link', () => {
    process.env.APP_PUBLIC_ORIGIN = 'http://klip.kpndomain.com/';
    expect(jpsDocumentViewUrl('11111111-1111-1111-1111-111111111111')).toBe('http://klip.kpndomain.com/api/documents/11111111-1111-1111-1111-111111111111/view');
    expect(jpsDocumentViewUrl(' ')).toBeUndefined();
    delete process.env.APP_PUBLIC_ORIGIN;
    delete process.env.FRONTEND_URL;
    expect(jpsDocumentViewUrl('11111111-1111-1111-1111-111111111111')).toBeUndefined();
  });
});
