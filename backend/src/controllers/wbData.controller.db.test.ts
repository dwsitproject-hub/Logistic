import { afterAll, describe, expect, it } from 'vitest';
import type { Response } from 'express';
import pool from '../database/connection';
import type { AuthRequest } from '../middleware/auth';
import { getWbImport, listWbImports } from './wbData.controller';

/**
 * WB Data page, against the database (read-only): the two queries have to RUN and answer in the shape the page reads - who uploaded, when, what it did.
 * The data checks are skipped when the database holds no WB upload.
 */
function fakeRes() {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, out };
}

describe('WB Data controller (against the database)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('lists the uploads newest first with the uploader and the times', async () => {
    const { res, out } = fakeRes();
    await listWbImports({} as AuthRequest, res);
    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
    const rows = out.body.data as any[];
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows.slice(0, 5)) {
      for (const key of ['id', 'file_name', 'status', 'created_at', 'updated_at', 'uploaded_by_name', 'rows_upserted', 'operations_updated', 'operations_failed', 'sheets_skipped_count', 'parse_failures_count']) {
        expect(r).toHaveProperty(key);
      }
    }
    const times = rows.map((r) => new Date(r.created_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('opens one upload with its sheets, failures and the rows it still holds', async () => {
    const list = fakeRes();
    await listWbImports({} as AuthRequest, list.res);
    const first = (list.out.body.data as any[])[0];
    if (!first) return; // no upload in this database
    const { res, out } = fakeRes();
    await getWbImport({ params: { id: first.id } } as unknown as AuthRequest, res);
    expect(out.status).toBe(200);
    const d = out.body.data;
    expect(d.import.id).toBe(first.id);
    expect(Array.isArray(d.import.sheets_processed)).toBe(true);
    expect(Array.isArray(d.import.operation_failures)).toBe(true);
    expect(Array.isArray(d.rows)).toBe(true);
    expect(d.rowsTotal).toBeGreaterThanOrEqual(d.rows.length);
  });

  it('answers 400 for a malformed id and 404 for an unknown one', async () => {
    const bad = fakeRes();
    await getWbImport({ params: { id: 'not-a-uuid' } } as unknown as AuthRequest, bad.res);
    expect(bad.out.status).toBe(400);
    const none = fakeRes();
    await getWbImport({ params: { id: '00000000-0000-0000-0000-000000000000' } } as unknown as AuthRequest, none.res);
    expect(none.out.status).toBe(404);
  });
});
