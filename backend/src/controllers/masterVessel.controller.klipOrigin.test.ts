import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const resolveMock = vi.fn();

vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  getClient: vi.fn(),
  default: { query: vi.fn() },
}));

vi.mock('../services/resolveMasterVessel.service', () => ({
  resolveMasterVessel: (...args: unknown[]) => resolveMock(...args),
}));

vi.mock('../dhm', () => ({
  pushMasterVesselToDhm: vi.fn(async () => ({})),
  attachDhmPushState: vi.fn(async (rows: unknown) => rows),
  wantsDhmOverwrite: vi.fn(() => false),
}));

import { createMasterVessel, deleteMasterVessel } from './masterVessel.controller';

const VESSEL_ID = '5216ddb2-0049-4360-9b54-a86ac757619c';

function mockRes() {
  const res: { statusCode: number; body: any; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    statusCode: 200,
    body: null,
    status(c) {
      res.statusCode = c;
      return res;
    },
    json(b) {
      res.body = b;
      return res;
    },
  };
  return res;
}

/** The protection SQL is the only one that joins shipments laterally; hand it the facts of the vessel under test. */
function wireQueries(protection: Record<string, unknown> | null) {
  queryMock.mockImplementation(async (sql: string) => {
    const text = String(sql);
    if (/LEFT JOIN LATERAL/.test(text) && /normalize_vessel_name\(s\.vessel_name\)/.test(text)) return { rows: protection ? [protection] : [] };
    if (/^\s*DELETE FROM master_vessels/i.test(text)) return { rows: [{ id: VESSEL_ID }] };
    if (/SELECT \* FROM master_vessels/i.test(text)) {
      return { rows: [{ id: VESSEL_ID, vessel_code: 'TMP-METRO0535', vessel_name: 'BG. METRO 05.35', code_status: 'PROVISIONAL' }] };
    }
    return { rows: [], rowCount: 1 };
  });
}

const facts = (over: Record<string, unknown> = {}) => ({
  id: VESSEL_ID,
  vessel_name: 'BG. METRO 05.35',
  vessel_code: 'TMP-METRO0535',
  linked_to_dhm: false,
  klip_origin: false,
  shipments_active: 0,
  shipments_cancelled: 0,
  ...over,
});

describe('createMasterVessel - klip_origin', () => {
  beforeEach(() => {
    queryMock.mockReset();
    resolveMock.mockReset();
  });

  const req = { body: { vessel_name: 'BG. METRO 05.35' }, query: {} } as never;

  it('flags a vessel this call CREATED, so the master cleanup keeps it', async () => {
    wireQueries(null);
    resolveMock.mockResolvedValue({ master_vessel_id: VESSEL_ID, created: true });
    const res = mockRes();
    await createMasterVessel(req, res as never);
    expect(res.statusCode).toBe(201);
    const flag = queryMock.mock.calls.find((c) => /UPDATE master_vessels SET klip_origin = TRUE/.test(String(c[0])));
    expect(flag).toBeTruthy();
    expect(flag![1]).toEqual([VESSEL_ID]);
  });

  it('flags nothing when the call only REUSED an existing vessel: its origin is whatever it already was', async () => {
    wireQueries(null);
    resolveMock.mockResolvedValue({ master_vessel_id: VESSEL_ID, created: false });
    const res = mockRes();
    await createMasterVessel(req, res as never);
    expect(res.statusCode).toBe(200);
    expect(queryMock.mock.calls.some((c) => /klip_origin/.test(String(c[0])))).toBe(false);
  });
});

describe('deleteMasterVessel - protection', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('refuses a vessel that was input in KLIP: 409, a named code, and no DELETE is ever sent', async () => {
    wireQueries(facts({ klip_origin: true, shipments_active: 1 }));
    const res = mockRes();
    await deleteMasterVessel({ params: { id: VESSEL_ID } } as never, res as never);
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('MASTER_VESSEL_PROTECTED');
    expect(res.body.error.reasons).toEqual(['klip_origin']);
    expect(res.body.error.message).toMatch(/BG\. METRO 05\.35/);
    expect(res.body.error.message).toMatch(/unlinks 1 active shipment/);
    expect(queryMock.mock.calls.some((c) => /DELETE FROM master_vessels/i.test(String(c[0])))).toBe(false);
  });

  it('still deletes a vessel the SAP import made, even one shipments use: those are meant to be replaced', async () => {
    wireQueries(facts({ klip_origin: false, shipments_active: 45, linked_to_dhm: true }));
    const res = mockRes();
    await deleteMasterVessel({ params: { id: VESSEL_ID } } as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe(VESSEL_ID);
    expect(queryMock.mock.calls.some((c) => /DELETE FROM master_vessels/i.test(String(c[0])))).toBe(true);
  });

  it('answers 404 for an id that does not exist', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/LEFT JOIN LATERAL/.test(String(sql))) return { rows: [] };
      return { rows: [] };
    });
    const res = mockRes();
    await deleteMasterVessel({ params: { id: VESSEL_ID } } as never, res as never);
    expect(res.statusCode).toBe(404);
  });
});
