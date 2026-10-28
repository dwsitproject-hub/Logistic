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

describe('NOT_FOUND: an instruction JPS no longer holds is marked Deleted, so it can be resubmitted', () => {
  const closedWrites = () => queryMock.mock.calls.filter((c) => /SET jps_status = 'Deleted'/.test(String(c[0])))

  beforeEach(() => {
    queryMock.mockReset();
    jpsRequestMock.mockReset();
    applyMock.mockReset();
  });

  it('Refresh: a NOT_FOUND for a known JPS id closes it and reports the change', async () => {
    queryMock.mockResolvedValue({ rows: [row({ last_polled_at: new Date(Date.now() - 3_600_000).toISOString() })] });
    jpsRequestMock.mockResolvedValue({ ok: false, status: 404, code: 'NOT_FOUND', message: 'Shipping instruction 77 not found', retryable: false });
    const out = await refreshInstructionFromJps('1006020269');
    expect(out).toEqual({ kind: 'refreshed', status: 'Deleted', previousStatus: 'Pending', changed: true });
    expect(closedWrites()).toHaveLength(1);
    expect(String(closedWrites()[0][1][1])).toContain('marked Deleted by KLIP');
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('Refresh: a NOT_FOUND when KLIP has no JPS id (looked up by reference) is NOT taken as deleted', async () => {
    queryMock.mockResolvedValue({ rows: [row({ jps_id: null, last_polled_at: null })] });
    jpsRequestMock.mockResolvedValue({ ok: false, status: 404, code: 'NOT_FOUND', message: 'not found', retryable: false });
    const out = await refreshInstructionFromJps('1006020269');
    expect(out.kind).toBe('failed');
    expect(closedWrites()).toHaveLength(0);
  });

  it('Refresh: a server problem (5xx) never closes it', async () => {
    queryMock.mockResolvedValue({ rows: [row({ last_polled_at: null })] });
    jpsRequestMock.mockResolvedValue({ ok: false, status: 503, code: 'UPSTREAM', message: 'unavailable', retryable: true });
    expect((await refreshInstructionFromJps('1006020269')).kind).toBe('failed');
    expect(closedWrites()).toHaveLength(0);
  });

  it('the sweep poll closes each instruction JPS answers NOT_FOUND for, counts it as changed, and leaves the others alone', async () => {
    const { pollSubmittedInstructions } = await import('./poll');
    queryMock.mockImplementation(async (text: string) => {
      if (/FROM jps_shipping_instructions\s+WHERE state = 'SUBMITTED'/.test(String(text))) {
        return {
          rows: [
            { id: 'r1', sto_key: 'OP-1', jps_id: 103, external_reference: 'KLIP-OP-1-R1', jps_status: 'Pending' },
            { id: 'r2', sto_key: 'OP-2', jps_id: 190, external_reference: 'KLIP-OP-2-R1', jps_status: 'Pending' },
          ],
        };
      }
      return { rows: [] };
    });
    jpsRequestMock.mockImplementation(async (cfg: { url: string }) =>
      cfg.url.endsWith('/103')
        ? { ok: false, status: 404, code: 'NOT_FOUND', message: 'Shipping instruction 103 not found', retryable: false }
        : { ok: true, data: { id: 190, status: 'Pending' } },
    );
    const summary = await pollSubmittedInstructions();
    expect(summary).toMatchObject({ polled: 2, changed: 1, errors: 0 });
    expect(closedWrites()).toHaveLength(1);
    expect(closedWrites()[0][1][0]).toBe('r1');
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0][0]).toBe('r2');
  });

  it('the sweep poll: an unreachable JPS is an error to retry, not a deletion', async () => {
    const { pollSubmittedInstructions } = await import('./poll');
    queryMock.mockImplementation(async (text: string) =>
      /FROM jps_shipping_instructions\s+WHERE state = 'SUBMITTED'/.test(String(text))
        ? { rows: [{ id: 'r1', sto_key: 'OP-1', jps_id: 103, external_reference: 'KLIP-OP-1-R1', jps_status: 'Approved' }] }
        : { rows: [] },
    );
    jpsRequestMock.mockResolvedValue({ ok: false, status: 502, code: 'BAD_GATEWAY', message: 'bad gateway', retryable: true });
    const summary = await pollSubmittedInstructions();
    expect(summary).toMatchObject({ errors: 1, changed: 0 });
    expect(closedWrites()).toHaveLength(0);
  });
});
