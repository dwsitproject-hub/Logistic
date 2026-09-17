import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const resolveContextMock = vi.fn();

vi.mock('../database/connection', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock('./shipmentEditContext.service', () => ({
  resolveShipmentEditContext: (...args: unknown[]) => resolveContextMock(...args),
}));

vi.mock('../database/ensureUserStoContractAssignments', () => ({
  ensureUserStoContractAssignmentsTable: vi.fn(async () => undefined),
}));

import { batchSaveShipmentPoKlipQty } from './shipmentPoAssignment.service';

describe('batchSaveShipmentPoKlipQty', () => {
  beforeEach(() => {
    queryMock.mockReset();
    resolveContextMock.mockReset();
  });

  it('updates each sibling shipment with that PO’s KLIP qty', async () => {
    resolveContextMock.mockResolvedValue({
      lookup_key: 'OP-1004030778-33324700',
      contract_numbers: '1004030778, 1014003113',
      po_numbers: '',
      has_sap_sto: false,
      can_add_po: true,
      add_po_blocked_reason: null,
    });
    queryMock
      .mockResolvedValueOnce({ rows: [{ shipment_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ shipment_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await batchSaveShipmentPoKlipQty({
      anchorShipmentUuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      rows: [
        {
          contractNumber: '1004030778',
          poNumber: '1001030778',
          quantityDeliveredKlipKg: 100_000,
          quantityReceiveKlipKg: 90_000,
        },
        {
          contractNumber: '1014003113',
          poNumber: '1011003113',
          quantityDeliveredKlipKg: 200_000,
          quantityReceiveKlipKg: 180_000,
        },
      ],
    });

    expect(result).toEqual({ ok: true });
    const updateCalls = queryMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && String(c[0]).includes('UPDATE shipments'),
    );
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][1]).toEqual([
      100_000,
      100_000,
      90_000,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ]);
    expect(updateCalls[1][1]).toEqual([
      200_000,
      200_000,
      180_000,
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);
  });

  it('resolves sibling via anchor operation_id when lookup_key is numeric STO', async () => {
    resolveContextMock.mockResolvedValue({
      lookup_key: '1016010976',
      contract_numbers: '1014003113, 1014003143',
      po_numbers: '',
      has_sap_sto: true,
      can_add_po: true,
      add_po_blocked_reason: null,
    });
    queryMock
      .mockResolvedValueOnce({ rows: [{ shipment_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ shipment_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await batchSaveShipmentPoKlipQty({
      anchorShipmentUuid: '4eaee5d8-1f96-4015-a373-f81eb67801b6',
      rows: [
        {
          contractNumber: '1014003113',
          quantityDeliveredKlipKg: 10_000,
          quantityReceiveKlipKg: null,
        },
        {
          contractNumber: '1014003143',
          quantityDeliveredKlipKg: 20_000,
          quantityReceiveKlipKg: null,
        },
      ],
    });

    expect(result).toEqual({ ok: true });
    const findCalls = queryMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && String(c[0]).includes('SELECT s.id::text'),
    );
    expect(findCalls[0][1]).toEqual([
      '1014003113',
      '1016010976',
      '4eaee5d8-1f96-4015-a373-f81eb67801b6',
    ]);
    expect(findCalls[1][1]).toEqual([
      '1014003143',
      '1016010976',
      '4eaee5d8-1f96-4015-a373-f81eb67801b6',
    ]);
  });

  it('returns 400 when sibling shipment is missing', async () => {
    resolveContextMock.mockResolvedValue({
      lookup_key: 'OP-1004030778-33324700',
      contract_numbers: '1004030778',
      po_numbers: '',
      has_sap_sto: false,
      can_add_po: true,
      add_po_blocked_reason: null,
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await batchSaveShipmentPoKlipQty({
      anchorShipmentUuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      rows: [
        {
          contractNumber: '1004030778',
          quantityDeliveredKlipKg: 50_000,
          quantityReceiveKlipKg: null,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toContain('No sibling shipment');
    }
  });
});
