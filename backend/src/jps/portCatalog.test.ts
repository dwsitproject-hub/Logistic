import { beforeEach, describe, expect, it, vi } from 'vitest';

const { jpsRequestMock } = vi.hoisted(() => ({ jpsRequestMock: vi.fn() }));
vi.mock('./client', () => ({ jpsRequest: jpsRequestMock }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { fetchJpsKnownPorts, parseJpsPortCatalog, resetJpsPortCatalogForTests } from './portCatalog';
import { buildJpsSubmitPayload, type JpsShipmentSource } from './mapper';
import { classifyPayloadProblem } from './readiness';

const rows = [
  { jps_port_id: 1, hub_code: 'PORT-0048', name: 'PORT BONTANG' },
  { jps_port_id: 11, hub_code: 'port-0010', name: 'PORT DUMAI' },
];

describe('the ports JPS knows (GET /catalog/port)', () => {
  beforeEach(() => {
    jpsRequestMock.mockReset();
    resetJpsPortCatalogForTests();
  });

  it('reads the hub codes, upper-cased', () => {
    expect(parseJpsPortCatalog({ referenceRows: rows })).toEqual(new Set(['PORT-0048', 'PORT-0010']));
  });

  it('a body that is not the catalog, or an empty one, is unknown (an empty catalog would hold every STO)', () => {
    expect(parseJpsPortCatalog(null)).toBeNull();
    expect(parseJpsPortCatalog({})).toBeNull();
    expect(parseJpsPortCatalog({ referenceRows: [] })).toBeNull();
    expect(parseJpsPortCatalog({ referenceRows: [{ name: 'no code' }] })).toBeNull();
  });

  it('asks JPS once and keeps the answer for a few minutes', async () => {
    jpsRequestMock.mockResolvedValue({ ok: true, data: { referenceRows: rows } });
    const a = await fetchJpsKnownPorts();
    const b = await fetchJpsKnownPorts();
    expect(a).toEqual(new Set(['PORT-0048', 'PORT-0010']));
    expect(b).toBe(a);
    expect(jpsRequestMock).toHaveBeenCalledTimes(1);
    expect(jpsRequestMock.mock.calls[0][0]).toMatchObject({ method: 'GET', url: '/catalog/port' });
  });

  it('when JPS cannot be asked the answer is unknown, and it is asked again next time (a failure is not cached)', async () => {
    jpsRequestMock.mockResolvedValueOnce({ ok: false, status: 503, code: 'UPSTREAM', message: 'unavailable', retryable: true });
    expect(await fetchJpsKnownPorts()).toBeNull();
    jpsRequestMock.mockResolvedValueOnce({ ok: true, data: { referenceRows: rows } });
    expect(await fetchJpsKnownPorts()).toEqual(new Set(['PORT-0048', 'PORT-0010']));
    expect(jpsRequestMock).toHaveBeenCalledTimes(2);
  });
});

function source(overrides: Partial<JpsShipmentSource> = {}): JpsShipmentSource {
  return {
    sto_key: '1006019026',
    revision: 1,
    vessel_name: 'BG. MARINI I',
    vessel_hub_code: 'VSL-0001',
    port_hub_code: 'PORT-0010',
    eta_discharge_arrival: '2026-09-18',
    eta_discharge_complete: '2026-09-20',
    incoterm: 'FOB',
    cargo: [{ contract_no: 'C1', po_no: 'P1', product: 'CPO', product_hub_code: 'CMD-0006', sto_quantity_kg: 300000, contract_quantity_kg: 300000 }],
    ...overrides,
  } as JpsShipmentSource;
}

describe('an STO whose port JPS does not know is held, not sent to be refused', () => {
  const known = new Set(['PORT-0048', 'PORT-0010']);

  it('a port in the catalog passes (matched without regard to case)', () => {
    const r = buildJpsSubmitPayload(source({ port_hub_code: 'port-0010' }), { knownPortCodes: known });
    expect(r.problems).toEqual([]);
    expect(r.payload?.port_hub_code).toBe('port-0010');
  });

  it('a port with a DHM code that is not in the catalog is held, with the reason and no payload', () => {
    const r = buildJpsSubmitPayload(source({ port_hub_code: 'PORT-0099' }), { knownPortCodes: known });
    expect(r.payload).toBeFalsy();
    expect(r.problems).toEqual(['discharge port PORT-0099 is not known to JPS (not in its port list); JPS would refuse it']);
  });

  it('when the catalog was not read (null) or was not asked for, nothing is held for it', () => {
    expect(buildJpsSubmitPayload(source({ port_hub_code: 'PORT-0099' }), { knownPortCodes: null }).problems).toEqual([]);
    expect(buildJpsSubmitPayload(source({ port_hub_code: 'PORT-0099' })).problems).toEqual([]);
  });

  it('a port with no DHM code at all keeps its own reason (it is not also "not known to JPS")', () => {
    const r = buildJpsSubmitPayload(source({ port_hub_code: null }), { knownPortCodes: known });
    expect(r.problems).toEqual(['discharge port has no DHM code on Master Port']);
  });

  it('the Submit to Jetty dialog sends the user to JPS, not to a KLIP master page', () => {
    const r = classifyPayloadProblem('discharge port PORT-0099 is not known to JPS (not in its port list); JPS would refuse it');
    expect(r.fixAt).toBe('jps');
    expect(r.fix).toContain('Ask the JPS team');
  });
});
