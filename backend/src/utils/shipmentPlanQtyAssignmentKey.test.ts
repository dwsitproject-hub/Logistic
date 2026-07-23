import { describe, expect, it, vi } from 'vitest';
import {
  parseShipmentPlanQtyAssignmentKey,
  resolveShipmentPlanQtyAssignmentTargets,
} from './shipmentPlanQtyAssignmentKey';

describe('parseShipmentPlanQtyAssignmentKey', () => {
  it('parses UUID keys', () => {
    expect(parseShipmentPlanQtyAssignmentKey('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toEqual({
      kind: 'uuid',
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
  });

  it('parses contract::po keys', () => {
    expect(parseShipmentPlanQtyAssignmentKey('4500123456::PO-1')).toEqual({
      kind: 'contract_po',
      contractNumber: '4500123456',
      poNumber: 'PO-1',
    });
  });

  it('parses bare contract numbers', () => {
    expect(parseShipmentPlanQtyAssignmentKey('4500123456')).toEqual({
      kind: 'contract',
      contractNumber: '4500123456',
    });
  });

  it('returns null for blank', () => {
    expect(parseShipmentPlanQtyAssignmentKey('  ')).toBeNull();
  });
});

describe('resolveShipmentPlanQtyAssignmentTargets', () => {
  it('resolves mixed UUID and contract::po keys to targets', async () => {
    const resolveUuid = vi.fn(async () => {
      const map = new Map<string, { contractNumber: string; poNumber: string | null }>();
      map.set('a1b2c3d4-e5f6-7890-abcd-ef1234567890', {
        contractNumber: '4500999',
        poNumber: 'PO-UUID',
      });
      return map;
    });

    const targets = await resolveShipmentPlanQtyAssignmentTargets(
      {
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890': '4000',
        '4500123456::PO-1': '12.5',
        '4500888': '1',
        skip: '0',
      },
      resolveUuid,
    );

    expect(resolveUuid).toHaveBeenCalledWith(['a1b2c3d4-e5f6-7890-abcd-ef1234567890']);
    expect(targets).toHaveLength(3);
    expect(targets).toEqual(
      expect.arrayContaining([
        { contractNumber: '4500123456', poNumber: 'PO-1', qtyMt: 12.5 },
        { contractNumber: '4500888', poNumber: null, qtyMt: 1 },
        { contractNumber: '4500999', poNumber: 'PO-UUID', qtyMt: 4000 },
      ]),
    );
  });
});
