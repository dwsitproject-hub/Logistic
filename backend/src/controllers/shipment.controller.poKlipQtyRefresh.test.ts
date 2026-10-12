import { beforeEach, describe, expect, it, vi } from 'vitest';

const batchSaveMock = vi.fn();
const refreshForShipmentIdsMock = vi.fn(async () => 0);
const scheduleCpRefreshMock = vi.fn();

vi.mock('../database/connection', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  getClient: vi.fn(),
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock('../services/shipmentPoAssignment.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/shipmentPoAssignment.service')>()),
  batchSaveShipmentPoKlipQty: (...args: unknown[]) => batchSaveMock(...args),
}));

vi.mock('../services/contractQtyMoveSnapshot.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/contractQtyMoveSnapshot.service')>()),
  ContractQtyMoveSnapshotService: {
    refreshForShipmentIds: (...args: unknown[]) => refreshForShipmentIdsMock(...(args as [])),
  },
}));

vi.mock('../services/contractPerformanceSnapshot.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/contractPerformanceSnapshot.service')>()),
  scheduleContractPerformanceRefreshForShipments: (...args: unknown[]) => scheduleCpRefreshMock(...args),
}));

import { batchSaveShipmentPoKlipQtyHandler } from './shipment.controller';

const ANCHOR = '0e97bb00-0000-4000-8000-000000001de8';
const SIB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SIB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function mockRes() {
  const res: { statusCode: number; body: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
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

/**
 * Clearing Delivered on one PO of a 3-PO group read 2,000 MT delivered and 1,000 MT OS afterwards: PUT /shipments/:id refreshes
 * contract_qty_move_snapshot for the anchor shipment only, and this endpoint - the one that writes the OTHER shipments - refreshed nothing.
 * Status (Completed) and OS both read that snapshot, so two contracts stayed "delivered".
 */
describe('batchSaveShipmentPoKlipQtyHandler - refresh after the write', () => {
  beforeEach(() => {
    batchSaveMock.mockReset();
    refreshForShipmentIdsMock.mockClear();
    scheduleCpRefreshMock.mockClear();
  });

  it('refreshes the qty_move and Contract Performance snapshots for the anchor and EVERY sibling written', async () => {
    batchSaveMock.mockResolvedValue({ ok: true, shipmentIds: [SIB_A, SIB_B, ANCHOR] });
    const res = mockRes();

    await batchSaveShipmentPoKlipQtyHandler(
      { params: { id: ANCHOR }, body: { rows: [{ contractNumber: '1', quantityDeliveredKlipKg: 0 }] } } as never,
      res as never,
    );

    expect(res.statusCode).toBe(200);
    const ids = refreshForShipmentIdsMock.mock.calls[0]?.[0] as unknown as string[];
    expect([...ids].sort()).toEqual([ANCHOR, SIB_A, SIB_B].sort());
    expect(scheduleCpRefreshMock).toHaveBeenCalledTimes(1);
    expect([...(scheduleCpRefreshMock.mock.calls[0][0] as string[])].sort()).toEqual([ANCHOR, SIB_A, SIB_B].sort());
  });

  it('refreshes nothing when the save was rejected', async () => {
    batchSaveMock.mockResolvedValue({ ok: false, status: 400, message: 'Invalid Shipment Plan Qty for 1' });
    const res = mockRes();

    await batchSaveShipmentPoKlipQtyHandler(
      { params: { id: ANCHOR }, body: { rows: [] } } as never,
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(refreshForShipmentIdsMock).not.toHaveBeenCalled();
    expect(scheduleCpRefreshMock).not.toHaveBeenCalled();
  });

  it('still answers 200 when the snapshot refresh itself fails, so a saved qty is not reported as an error', async () => {
    batchSaveMock.mockResolvedValue({ ok: true, shipmentIds: [SIB_A] });
    refreshForShipmentIdsMock.mockRejectedValueOnce(new Error('snapshot busy'));
    const res = mockRes();

    await batchSaveShipmentPoKlipQtyHandler(
      { params: { id: ANCHOR }, body: { rows: [] } } as never,
      res as never,
    );

    expect(res.statusCode).toBe(200);
  });
});
