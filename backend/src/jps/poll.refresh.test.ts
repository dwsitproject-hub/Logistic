import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, jpsRequestMock, applyMock } = vi.hoisted(() => ({ queryMock: vi.fn(), jpsRequestMock: vi.fn(), applyMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));
vi.mock('./client', () => ({ jpsRequest: jpsRequestMock }));
vi.mock('./applyInstruction', () => ({ applyJpsInstruction: applyMock }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { refreshInstructionFromJps } from './poll';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'row-1',
  jps_id: 77,
  external_reference: 'KLIP-1006020269-R1',
  jps_status: 'Pending',
  last_polled_at: null,
  ...over,
});

describe('refreshInstructionFromJps: ask JPS now about one STO', () => {
  beforeEach(() => {
    queryMock.mockReset();
    jpsRequestMock.mockReset();
    applyMock.mockReset();
  });

  it('nothing was submitted for this STO: nothing to ask', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect(await refreshInstructionFromJps('1006020269')).toEqual({ kind: 'none' });
    expect(jpsRequestMock).not.toHaveBeenCalled();
  });

  it('JPS asks for few polls: a poll inside the interval is not made, and says how long to wait', async () => {
    queryMock.mockResolvedValue({ rows: [row({ last_polled_at: new Date(Date.now() - 60_000).toISOString() })] });
    const out = await refreshInstructionFromJps('1006020269');
    expect(out.kind).toBe('too_soon');
    expect(out.kind === 'too_soon' && out.retryInSeconds).toBeGreaterThan(0);
    expect(out.kind === 'too_soon' && out.status).toBe('Pending');
    expect(jpsRequestMock).not.toHaveBeenCalled();
  });

  it('a rejection JPS made is written through the same apply as the sweep and the webhook', async () => {
    queryMock.mockResolvedValue({ rows: [row({ last_polled_at: new Date(Date.now() - 3_600_000).toISOString() })] });
    jpsRequestMock.mockResolvedValue({ ok: true, data: { id: 77, status: 'Rejected', rejection_reason: 'Berth not available' } });
    const out = await refreshInstructionFromJps('1006020269');
    expect(out).toEqual({ kind: 'refreshed', status: 'Rejected', previousStatus: 'Pending', changed: true });
    expect(applyMock).toHaveBeenCalledWith('row-1', expect.objectContaining({ status: 'Rejected' }));
    expect(jpsRequestMock.mock.calls[0][0]).toMatchObject({ method: 'GET', url: '/shipping-instructions/77' });
  });

  it('an unchanged answer is reported as unchanged', async () => {
    queryMock.mockResolvedValue({ rows: [row()] });
    jpsRequestMock.mockResolvedValue({ ok: true, data: { id: 77, status: 'Pending' } });
    expect(await refreshInstructionFromJps('1006020269')).toMatchObject({ kind: 'refreshed', changed: false });
  });

  it('without a JPS id it finds the instruction by its external reference', async () => {
    queryMock.mockResolvedValue({ rows: [row({ jps_id: null })] });
    jpsRequestMock.mockResolvedValue({ ok: true, data: { id: 77, status: 'Pending' } });
    await refreshInstructionFromJps('1006020269');
    expect(jpsRequestMock.mock.calls[0][0]).toMatchObject({ url: '/shipping-instructions', params: { external_reference: 'KLIP-1006020269-R1' } });
  });

  it('a failed call is reported, stamped on the row, and applies nothing', async () => {
    queryMock.mockResolvedValue({ rows: [row()] });
    jpsRequestMock.mockResolvedValue({ ok: false, status: 503, code: 'UPSTREAM', message: 'unavailable', retryable: true });
    const out = await refreshInstructionFromJps('1006020269');
    expect(out).toEqual({ kind: 'failed', message: 'UPSTREAM: unavailable' });
    expect(applyMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some((c) => /UPDATE jps_shipping_instructions/.test(String(c[0])))).toBe(true);
  });
});
