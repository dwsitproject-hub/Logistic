import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./config', () => ({
  isJpsEnabled: vi.fn(() => true),
  jpsWebhookSecret: vi.fn(() => 'whsec_test_secret'),
}));
vi.mock('./applyInstruction', () => ({ applyJpsInstruction: vi.fn() }));
vi.mock('./callLog', () => ({
  recordJpsCall: vi.fn(),
  stoKeyFromReference: (r: unknown) => {
    const m = /^KLIP-(.+)-R\d+$/.exec(String(r ?? ''));
    return m ? m[1] : null;
  },
}));
vi.mock('../services/shipmentList.service', () => ({ invalidateShipmentsListCache: vi.fn() }));

import { query } from '../database/connection';
import { applyJpsInstruction } from './applyInstruction';
import { recordJpsCall } from './callLog';
import { isJpsEnabled } from './config';
import { invalidateShipmentsListCache } from '../services/shipmentList.service';
import { parseJpsWebhookPayload, signJpsWebhook, verifyJpsSignature } from './webhook';
import { handleJpsWebhook } from './webhookHandler';

const SECRET = 'whsec_test_secret';
const TS = '1790000000000';

function body(overrides: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      event: 'status.changed',
      occurred_at: '2026-10-02T07:07:57.714Z',
      data: { id: 115, status: 'Approved', external_reference: 'KLIP-OP-1004031952-84745846-R1', ...overrides },
    }),
  );
}

function headersFor(raw: Buffer, extra: Record<string, string | undefined> = {}) {
  return {
    timestamp: TS,
    signature: `sha256=${signJpsWebhook(SECRET, TS, raw)}`,
    event: 'status.changed',
    deliveryId: 'dlv_1',
    ...extra,
  };
}

describe('verifyJpsSignature', () => {
  it('accepts the signature JPS computes over "<timestamp>.<raw body>"', () => {
    const raw = body();
    expect(verifyJpsSignature(raw, headersFor(raw), SECRET)).toBe(true);
  });

  it('accepts the hex without the sha256= prefix, in either case', () => {
    const raw = body();
    const hex = signJpsWebhook(SECRET, TS, raw);
    expect(verifyJpsSignature(raw, { timestamp: TS, signature: hex }, SECRET)).toBe(true);
    expect(verifyJpsSignature(raw, { timestamp: TS, signature: `SHA256=${hex.toUpperCase()}` }, SECRET)).toBe(true);
  });

  it('refuses a body that was changed after signing', () => {
    const raw = body();
    const tampered = body({ status: 'Rejected' });
    expect(verifyJpsSignature(tampered, headersFor(raw), SECRET)).toBe(false);
  });

  it('refuses a different timestamp, a different secret, and a missing piece', () => {
    const raw = body();
    expect(verifyJpsSignature(raw, headersFor(raw, { timestamp: '1790000000001' }), SECRET)).toBe(false);
    expect(verifyJpsSignature(raw, headersFor(raw), 'whsec_other')).toBe(false);
    expect(verifyJpsSignature(raw, headersFor(raw, { signature: undefined }), SECRET)).toBe(false);
    expect(verifyJpsSignature(raw, headersFor(raw, { timestamp: undefined }), SECRET)).toBe(false);
  });

  it('refuses everything when no secret is configured', () => {
    const raw = body();
    expect(verifyJpsSignature(raw, headersFor(raw), '')).toBe(false);
  });

  it('refuses a signature of the wrong length without throwing', () => {
    expect(verifyJpsSignature(body(), { timestamp: TS, signature: 'sha256=abc' }, SECRET)).toBe(false);
  });
});

describe('parseJpsWebhookPayload', () => {
  it('reads an event with the instruction and the reference KLIP sent', () => {
    const parsed = parseJpsWebhookPayload(body());
    expect(parsed?.event).toBe('status.changed');
    expect(parsed?.data.external_reference).toBe('KLIP-OP-1004031952-84745846-R1');
  });

  it('refuses anything else', () => {
    expect(parseJpsWebhookPayload(Buffer.from('not json'))).toBeNull();
    expect(parseJpsWebhookPayload(Buffer.from('{"event":"x"}'))).toBeNull();
    expect(parseJpsWebhookPayload(body({ external_reference: '' }))).toBeNull();
  });
});

describe('handleJpsWebhook', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(applyJpsInstruction).mockReset();
    vi.mocked(recordJpsCall).mockReset();
    vi.mocked(invalidateShipmentsListCache).mockReset();
    vi.mocked(isJpsEnabled).mockReturnValue(true);
  });

  // delivered?  ->  row lookup  ->  (apply)  ->  mark delivered + prune
  function db(opts: { delivered?: boolean; row?: { id: string; jps_status: string } | null }) {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes('FROM jps_webhook_deliveries')) {
        return { rows: opts.delivered ? [{ '?column?': 1 }] : [], rowCount: opts.delivered ? 1 : 0 } as any;
      }
      if (text.includes('FROM jps_shipping_instructions')) {
        return { rows: opts.row ? [opts.row] : [], rowCount: opts.row ? 1 : 0 } as any;
      }
      return { rows: [], rowCount: 0 } as any;
    });
  }

  it('applies a signed delivery to the instruction it names, clears the list cache and answers 200', async () => {
    db({ row: { id: 'row-1', jps_status: 'Pending' } });
    const raw = body();
    const result = await handleJpsWebhook(raw, headersFor(raw));
    expect(result).toMatchObject({ accepted: true, status: 200 });
    expect(applyJpsInstruction).toHaveBeenCalledWith('row-1', expect.objectContaining({ status: 'Approved' }));
    expect(invalidateShipmentsListCache).toHaveBeenCalledTimes(1);
    // the delivery is written down AFTER it was applied
    const sqls = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    const insertAt = sqls.findIndex((s) => s.includes('INSERT INTO jps_webhook_deliveries'));
    expect(insertAt).toBeGreaterThan(-1);
    expect(vi.mocked(applyJpsInstruction).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(query).mock.invocationCallOrder[insertAt],
    );
  });

  it('refuses a delivery with a bad signature (401), touches nothing, and keeps no body', async () => {
    db({ row: { id: 'row-1', jps_status: 'Pending' } });
    const raw = body();
    const result = await handleJpsWebhook(raw, headersFor(raw, { signature: 'sha256=' + '0'.repeat(64) }));
    expect(result).toMatchObject({ accepted: false, status: 401 });
    expect(applyJpsInstruction).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(vi.mocked(recordJpsCall).mock.calls[0]![0]).toMatchObject({ kind: 'webhook', ok: false, requestBody: null });
  });

  it('answers 200 duplicate for a delivery it already applied, without applying it again', async () => {
    db({ delivered: true, row: { id: 'row-1', jps_status: 'Approved' } });
    const raw = body();
    const result = await handleJpsWebhook(raw, headersFor(raw));
    expect(result).toMatchObject({ accepted: true, status: 200, duplicate: true });
    expect(applyJpsInstruction).not.toHaveBeenCalled();
  });

  it('accepts and drops a delivery for a reference KLIP never sent, so JPS does not retry it', async () => {
    db({ row: null });
    const raw = body({ external_reference: 'SOMEONE-ELSE-1' });
    const result = await handleJpsWebhook(raw, headersFor(raw));
    expect(result).toMatchObject({ accepted: true, status: 200, ignored: 'unknown external_reference' });
    expect(applyJpsInstruction).not.toHaveBeenCalled();
  });

  it('answers 500 when applying fails, and does not write the delivery down, so the retry is processed', async () => {
    db({ row: { id: 'row-1', jps_status: 'Pending' } });
    vi.mocked(applyJpsInstruction).mockRejectedValue(new Error('db down'));
    const raw = body();
    const result = await handleJpsWebhook(raw, headersFor(raw));
    expect(result).toMatchObject({ accepted: false, status: 500 });
    const sqls = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('INSERT INTO jps_webhook_deliveries'))).toBe(false);
  });

  it('refuses a malformed body with 400 and a delivery with no id with 400', async () => {
    db({ row: { id: 'row-1', jps_status: 'Pending' } });
    const junk = Buffer.from('{"event":"x"}');
    expect(await handleJpsWebhook(junk, headersFor(junk))).toMatchObject({ accepted: false, status: 400 });
    const raw = body();
    expect(await handleJpsWebhook(raw, headersFor(raw, { deliveryId: undefined }))).toMatchObject({
      accepted: false,
      status: 400,
    });
  });

  it('answers 503 while the integration is switched off', async () => {
    vi.mocked(isJpsEnabled).mockReturnValue(false);
    const raw = body();
    expect(await handleJpsWebhook(raw, headersFor(raw))).toMatchObject({ accepted: false, status: 503 });
    expect(applyJpsInstruction).not.toHaveBeenCalled();
  });

  it('writes every delivery into the call history as a webhook', async () => {
    db({ row: { id: 'row-1', jps_status: 'Pending' } });
    const raw = body();
    await handleJpsWebhook(raw, headersFor(raw));
    expect(vi.mocked(recordJpsCall).mock.calls[0]![0]).toMatchObject({
      kind: 'webhook',
      method: 'POST',
      url: '/api/jps/webhooks',
      stoKey: 'OP-1004031952-84745846',
      requestId: 'dlv_1',
      ok: true,
    });
  });
});
