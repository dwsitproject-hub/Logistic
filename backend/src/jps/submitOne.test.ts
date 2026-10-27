import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, jpsRequestMock } = vi.hoisted(() => ({ queryMock: vi.fn(), jpsRequestMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));
vi.mock('./client', () => ({ jpsRequest: jpsRequestMock }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { submitOneSto } from './submit';
import type { EligibleSto } from './eligibility';

function sto(overrides: Partial<EligibleSto> = {}): EligibleSto {
  return {
    sto_key: '1006020269',
    shipment_ids: ['s1'],
    revision: 1,
    vessel_name: 'MT. MULIA KARSA 2',
    vessel_hub_code: 'VSL-0179',
    port_hub_code: 'PRT-BONTANG',
    eta_discharge_arrival: '2026-10-29',
    eta_discharge_complete: null,
    incoterm: 'FOB',
    cargo: [{ contract_no: 'C1', po_no: 'P1', product: 'POME', product_hub_code: 'CMD-0009', sto_quantity_kg: 1000, contract_quantity_kg: 1000 }],
    ...overrides,
  } as EligibleSto;
}

/** query() answers: nextRevision (highest 0), rowWouldChange (no row yet), and every write. */
function dbEmpty() {
  queryMock.mockImplementation(async (text: string) => {
    if (/MAX\(revision\)/.test(text)) return { rows: [{ highest: 0, highest_failed: 0 }] };
    if (/SELECT state, last_error/.test(text)) return { rows: [] };
    return { rows: [] };
  });
}
const writes = () => queryMock.mock.calls.map((c) => String(c[0])).filter((t) => /^\s*INSERT/.test(t));

describe('submitOneSto: what happened to one STO, and what was recorded', () => {
  beforeEach(() => {
    queryMock.mockReset();
    jpsRequestMock.mockReset();
    dbEmpty();
  });

  it('JPS accepted it: submitted, with the instruction, recorded as SUBMITTED', async () => {
    jpsRequestMock.mockResolvedValue({ ok: true, data: { id: 77, status: 'Pending', external_reference: 'KLIP-1006020269-R1' } });
    const out = await submitOneSto(sto(), null);
    expect(out).toMatchObject({ kind: 'submitted', revision: 1 });
    expect(out.kind === 'submitted' && out.instruction.status).toBe('Pending');
    expect(writes().some((t) => t.includes("'SUBMITTED'"))).toBe(true);
  });

  it('JPS refused it: failed, with JPS\'s message AND each detail line, recorded as FAILED', async () => {
    jpsRequestMock.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Payload validation failed',
      details: [{ field: 'vessel_name', issue: 'Master vessel LOA is missing' }],
      requestId: 'req-1',
      retryable: false,
    });
    const out = await submitOneSto(sto(), null);
    expect(out.kind).toBe('failed');
    if (out.kind !== 'failed') return;
    expect(out.code).toBe('VALIDATION_ERROR');
    expect(out.details).toEqual(['vessel_name: Master vessel LOA is missing']);
    expect(out.message).toContain('Master vessel LOA is missing');
    expect(out.requestId).toBe('req-1');
    expect(out.listChanged).toBe(true);
    expect(writes().some((t) => t.includes("'FAILED'"))).toBe(true);
  });

  it('a timeout or 5xx is retryable and writes NOTHING (the sweep will try again)', async () => {
    jpsRequestMock.mockResolvedValue({ ok: false, status: 503, code: 'UPSTREAM', message: 'unavailable', retryable: true, requestId: 'req-2' });
    const out = await submitOneSto(sto(), null);
    expect(out).toMatchObject({ kind: 'retryable', status: 503, requestId: 'req-2' });
    expect(writes()).toHaveLength(0);
  });

  it('missing master data is held BEFORE any request: no call to JPS, recorded as held', async () => {
    const out = await submitOneSto(sto({ vessel_hub_code: null }), null);
    expect(out.kind).toBe('held');
    expect(out.kind === 'held' && out.problems.join(' ')).toContain('no DHM code on Master Vessel');
    expect(jpsRequestMock).not.toHaveBeenCalled();
    expect(writes().some((t) => t.includes("'SKIPPED_NO_CARGO'"))).toBe(true);
  });

  it('a duplicate reference is recovered, not recorded as a second instruction', async () => {
    jpsRequestMock
      .mockResolvedValueOnce({ ok: false, status: 409, code: 'DUPLICATE_REFERENCE', message: 'exists', retryable: false })
      .mockResolvedValueOnce({ ok: true, data: { id: 78, status: 'Approved', external_reference: 'KLIP-1006020269-R1' } });
    const out = await submitOneSto(sto(), null);
    expect(out).toMatchObject({ kind: 'recovered', revision: 1 });
    expect(jpsRequestMock).toHaveBeenCalledTimes(2);
  });

  it('retrying a FAILED STO reuses its revision, so JPS never sees two references', async () => {
    queryMock.mockImplementation(async (text: string) => {
      if (/MAX\(revision\)/.test(text)) return { rows: [{ highest: 3, highest_failed: 3 }] };
      return { rows: [] };
    });
    jpsRequestMock.mockResolvedValue({ ok: true, data: { id: 79, status: 'Pending', external_reference: 'KLIP-1006020269-R3' } });
    const out = await submitOneSto(sto(), null);
    expect(out).toMatchObject({ kind: 'submitted', revision: 3 });
  });
});
