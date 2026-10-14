import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
vi.mock('../database/connection', () => ({ query: (...args: unknown[]) => queryMock(...args), default: {} }));
vi.mock('../database/ensureUserStoContractAssignments', () => ({ ensureUserStoContractAssignmentsTable: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./shipmentList.service', () => ({ invalidateShipmentsListCache: vi.fn() }));
vi.mock('./shippingPerformance.service', () => ({ invalidateShippingPerformanceRowCache: vi.fn() }));

import { cancelKlipShipmentGroup, groupHasSapImportedShell, KlipShipmentCancelError } from './cancelKlipShipment.service';

const ANCHOR = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER = '742f4dd8-9a43-443a-acfa-85841b532b6d';

/** Routes each statement by its text: the anchor read, the SAP lookup, the SAP-imported-shell probe and the cancel UPDATE. */
function routeQueries(opts: { anchor: Record<string, unknown>; sapStoInSpd?: boolean; sapImportedShell?: boolean }) {
  queryMock.mockImplementation(async (text: string) => {
    if (/s\.operation_id,\s*s\.shipment_id,\s*c\.sto_number/.test(text)) return { rows: [opts.anchor] };
    if (/FROM sap_processed_data spd/.test(text)) return { rows: opts.sapStoInSpd ? [{}] : [] };
    if (/operation_id_source/.test(text)) return { rows: opts.sapImportedShell ? [{}] : [] };
    if (/UPDATE shipments s/.test(text)) return { rows: [{ id: ANCHOR }], rowCount: 1 };
    if (/INSERT INTO remarks/.test(text)) return { rows: [{ id: 'remark-1' }] };
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => queryMock.mockReset());

describe('cancelKlipShipmentGroup and a SAP shell that carries an OP-SEA id', () => {
  it('REFUSES a SAP-imported STO even though its OP-SEA id looks KLIP-only', async () => {
    routeQueries({
      anchor: { id: ANCHOR, status: 'PLANNED', operation_id: 'OP-SEA-030920260454', shipment_id: '1006018854', sto_number: null },
      sapStoInSpd: false, // the OP- key is not a SAP STO, so the older check alone lets it through
      sapImportedShell: true,
    });
    const err = await cancelKlipShipmentGroup(ANCHOR, 'duplicate', USER).catch((e) => e);
    expect(err).toBeInstanceOf(KlipShipmentCancelError);
    expect((err as KlipShipmentCancelError).statusCode).toBe(403);
    expect(queryMock.mock.calls.some(([text]) => /UPDATE shipments s/.test(String(text)))).toBe(false);
  });

  it('still cancels a KLIP-planned group (no SAP_IMPORT row in it)', async () => {
    routeQueries({
      anchor: { id: ANCHOR, status: 'PLANNED', operation_id: 'OP-SEA-030920260455', shipment_id: 'MNL-1700-1004029379', sto_number: null },
      sapImportedShell: false,
    });
    const result = await cancelKlipShipmentGroup(ANCHOR, 'duplicate', USER);
    expect(result.cancelled_shipment_ids).toEqual([ANCHOR]);
  });

  it('a SAP numeric key without an operation id is refused as before', async () => {
    routeQueries({ anchor: { id: ANCHOR, status: 'PLANNED', operation_id: null, shipment_id: '1006018854', sto_number: null } });
    const err = await cancelKlipShipmentGroup(ANCHOR, 'duplicate', USER).catch((e) => e);
    expect((err as KlipShipmentCancelError).statusCode).toBe(403);
  });
});

describe('groupHasSapImportedShell', () => {
  it('looks at the anchor and every open row sharing the group key, and only at SAP_IMPORT ids', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect(await groupHasSapImportedShell('OP-SEA-030920260454', ANCHOR)).toBe(false);
    const [text, params] = queryMock.mock.calls[0];
    expect(String(text)).toMatch(/operation_id_source/);
    expect(String(text)).toMatch(/<> 'CANCELLED'/);
    expect(params).toEqual(['OP-SEA-030920260454', ANCHOR]);
  });

  it('an empty key is never a SAP shell (no query)', async () => {
    expect(await groupHasSapImportedShell('  ', ANCHOR)).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
