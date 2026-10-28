import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, jpsRequestMock, findMock } = vi.hoisted(() => ({ queryMock: vi.fn(), jpsRequestMock: vi.fn(), findMock: vi.fn() }));
vi.mock('../database/connection', () => ({ query: queryMock }));
vi.mock('./client', () => ({ jpsRequest: jpsRequestMock }));
vi.mock('./eligibility', () => ({ findEligibleStos: findMock }));
vi.mock('./companies', () => ({ fetchJpsPortCompanies: vi.fn().mockResolvedValue(null), companiesForPort: vi.fn(() => []) }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { submitEligibleStos } from './submit';

const sto = (key: string) => ({
  sto_key: key,
  shipment_ids: ['s1'],
  revision: 1,
  vessel_name: 'MT. TEST',
  vessel_hub_code: 'VSL-1',
  port_hub_code: 'PRT-1',
  eta_discharge_arrival: '2026-10-29',
  eta_discharge_complete: null,
  incoterm: 'FOB',
  cargo: [{ contract_no: 'C1', po_no: 'P1', product: 'POME', product_hub_code: 'CMD-1', sto_quantity_kg: 1000, contract_quantity_kg: 1000 }],
});

describe('the sweep over the ports switched on', () => {
  const env = { ...process.env };
  beforeEach(() => {
    findMock.mockReset();
    queryMock.mockReset();
    jpsRequestMock.mockReset();
    queryMock.mockImplementation(async (text: string) => (/MAX\(revision\)/.test(String(text)) ? { rows: [{ highest: 0, highest_failed: 0 }] } : { rows: [] }));
    jpsRequestMock.mockResolvedValue({ ok: true, data: { id: 1, status: 'Pending', external_reference: 'KLIP-x-R1' } });
    process.env.JPS_PORTS = JSON.stringify([
      { port: 'PORT BONTANG', enabled: true },
      { port: 'PORT DUMAI', enabled: true },
      { port: 'PORT KUMAI', enabled: false },
    ]);
    process.env.JPS_MAX_SUBMITS_PER_SWEEP = '3';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('asks ONCE, for every port that is switched on and never the one that is off, under the one per-sweep cap', async () => {
    findMock.mockResolvedValue([]);
    await submitEligibleStos();
    expect(findMock).toHaveBeenCalledTimes(1);
    expect(findMock.mock.calls[0][0]).toEqual(['PORT BONTANG', 'PORT DUMAI']);
    expect(findMock.mock.calls[0][1]).toBe(3);
  });

  it('sends what it found', async () => {
    findMock.mockResolvedValue([sto('A'), sto('B')]);
    const summary = await submitEligibleStos();
    expect(summary.considered).toBe(2);
    expect(summary.submitted).toBe(2);
  });

  it('with no port switched on it asks for an empty list and sends nothing', async () => {
    process.env.JPS_PORTS = JSON.stringify([{ port: 'PORT KUMAI', enabled: false }]);
    findMock.mockResolvedValue([]);
    const off = await submitEligibleStos();
    delete process.env.JPS_PORTS;
    const none = await submitEligibleStos();
    expect(findMock.mock.calls.map((c) => c[0])).toEqual([[], []]);
    expect(off.considered + none.considered).toBe(0);
    expect(jpsRequestMock).not.toHaveBeenCalled();
  });
});
