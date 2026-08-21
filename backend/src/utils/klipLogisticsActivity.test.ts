import { describe, expect, it, vi } from 'vitest';

function mockDb(queryFn: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) {
  return { query: queryFn, release: () => undefined };
}
import {
  canSupersedeShipmentForStoChange,
  fetchLatestSapStoKeysForPo,
  findKlipPlannedStoSupersedeCandidate,
  finalizeSapShipmentAfterUpsert,
  isKlipManualShipmentId,
  isPlaceholderShipmentEligibleForSapConsolidate,
  isSapSourcedShipmentId,
  isStoReplacedInLatestSap,
  isTerminalShipmentExecutionStatus,
  reconcileSupersededNumericStoSiblings,
} from './klipLogisticsActivity';

describe('klipLogisticsActivity ids', () => {
  it('detects SAP numeric shipment ids', () => {
    expect(isSapSourcedShipmentId('1006018592')).toBe(true);
    expect(isSapSourcedShipmentId('MNL-12345678-1004029379')).toBe(false);
    expect(isSapSourcedShipmentId('MSEA-abc')).toBe(false);
  });

  it('detects KLIP manual shipment ids', () => {
    expect(isKlipManualShipmentId('MNL-123')).toBe(true);
    expect(isKlipManualShipmentId('1006018592')).toBe(false);
  });
});

describe('isPlaceholderShipmentEligibleForSapConsolidate', () => {
  it('allows MNL placeholders in planned status', () => {
    expect(isPlaceholderShipmentEligibleForSapConsolidate('PLANNED', 'MNL-abc')).toBe(true);
  });

  it('blocks COMPLETED SAP shipments from auto-cancel', () => {
    expect(isPlaceholderShipmentEligibleForSapConsolidate('COMPLETED', '1006018592')).toBe(false);
  });

  it('blocks in-progress SAP numeric STO rows', () => {
    expect(isPlaceholderShipmentEligibleForSapConsolidate('IN_TRANSIT', '1006018592')).toBe(false);
  });

  it('blocks already cancelled rows', () => {
    expect(isPlaceholderShipmentEligibleForSapConsolidate('CANCELLED', 'MNL-x')).toBe(false);
  });
});

describe('isTerminalShipmentExecutionStatus', () => {
  it('treats SAILED and COMPLETED as terminal', () => {
    expect(isTerminalShipmentExecutionStatus('SAILED')).toBe(true);
    expect(isTerminalShipmentExecutionStatus('COMPLETED')).toBe(true);
    expect(isTerminalShipmentExecutionStatus('PLANNED')).toBe(false);
  });
});

describe('isStoReplacedInLatestSap', () => {
  it('returns true when new STO is in latest SAP and old is absent', async () => {
    const db = mockDb(vi.fn().mockResolvedValue({
      rows: [{ sto_key: '1016010973' }],
    }));
    await expect(
      isStoReplacedInLatestSap(db, '1011003113', '1016010976', '1016010973'),
    ).resolves.toBe(true);
  });

  it('returns false when both old and new STO appear (parallel)', async () => {
    const db = mockDb(vi.fn().mockResolvedValue({
      rows: [{ sto_key: '1016010610' }, { sto_key: '1016010636' }],
    }));
    await expect(
      isStoReplacedInLatestSap(db, '1011002977', '1016010610', '1016010636'),
    ).resolves.toBe(false);
  });

  it('returns false when new STO is missing from latest SAP', async () => {
    const db = mockDb(vi.fn().mockResolvedValue({
      rows: [{ sto_key: '1016010976' }],
    }));
    await expect(
      isStoReplacedInLatestSap(db, '1011003113', '1016010976', '1016010973'),
    ).resolves.toBe(false);
  });
});

describe('canSupersedeShipmentForStoChange', () => {
  it('allows numeric SAP row with operation_id for STO change', async () => {
    const shipmentUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const contractUuid = '11111111-2222-3333-4444-555555555555';
    const db = mockDb(vi.fn(async (text: string) => {
        if (text.includes('FROM shipments WHERE id')) {
          return {
            rows: [
              {
                status: 'PLANNED',
                shipment_id: '1016010976',
                operation_id: 'OP-SEA-001',
                daily_deliverables: null,
              },
            ],
          };
        }
        if (text.includes('FROM documents')) return { rows: [] };
        if (text.includes('user_sto_contract_assignments')) return { rows: [] };
        return { rows: [] };
      }));
    await expect(
      canSupersedeShipmentForStoChange(db, shipmentUuid, contractUuid, '1016010973'),
    ).resolves.toBe(true);
  });

  it('blocks numeric SAP row without planning', async () => {
    const shipmentUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const db = mockDb(vi.fn(async (text: string) => {
        if (text.includes('FROM shipments WHERE id')) {
          return {
            rows: [
              {
                status: 'PLANNED',
                shipment_id: '1016010976',
                operation_id: null,
                daily_deliverables: null,
              },
            ],
          };
        }
        return { rows: [] };
      }));
    await expect(
      canSupersedeShipmentForStoChange(db, shipmentUuid, undefined, '1016010973'),
    ).resolves.toBe(false);
  });

  it('blocks COMPLETED rows even with operation_id', async () => {
    const shipmentUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const db = mockDb(vi.fn(async () => ({
        rows: [
          {
            status: 'COMPLETED',
            shipment_id: '1016010976',
            operation_id: 'OP-SEA-001',
            daily_deliverables: null,
          },
        ],
      })));
    await expect(
      canSupersedeShipmentForStoChange(db, shipmentUuid, undefined, '1016010973'),
    ).resolves.toBe(false);
  });
});

describe('findKlipPlannedStoSupersedeCandidate', () => {
  it('returns KLIP-planned row when SAP replaced old STO', async () => {
    const keeperId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const contractUuid = '11111111-2222-3333-4444-555555555555';
    const db = mockDb(vi.fn(async (text: string) => {
        if (text.includes('contract_id = $1::uuid') && text.includes('TRIM(shipment_id) = TRIM($2::text)')) {
          return { rows: [] };
        }
        if (text.includes('ORDER BY') && text.includes('operation_id')) {
          return {
            rows: [{ id: keeperId, shipment_id: '1016010976', operation_id: 'OP-SEA-001' }],
          };
        }
        if (text.includes('FROM shipments WHERE id')) {
          return {
            rows: [
              {
                status: 'PLANNED',
                shipment_id: '1016010976',
                operation_id: 'OP-SEA-001',
                daily_deliverables: null,
              },
            ],
          };
        }
        if (text.includes('FROM documents')) return { rows: [] };
        if (text.includes('user_sto_contract_assignments')) return { rows: [] };
        if (text.includes('latest_import')) {
          return { rows: [{ sto_key: '1016010973' }] };
        }
        return { rows: [] };
      }));

    await expect(
      findKlipPlannedStoSupersedeCandidate(db, contractUuid, '1016010973', '1011003113'),
    ).resolves.toBe(keeperId);
  });

  it('returns null when both STOs appear in latest SAP (parallel)', async () => {
    const contractUuid = '11111111-2222-3333-4444-555555555555';
    const db = mockDb(vi.fn(async (text: string) => {
        if (text.includes('TRIM(shipment_id) = TRIM($2::text)')) return { rows: [] };
        if (text.includes('ORDER BY') && text.includes('operation_id')) {
          return {
            rows: [{ id: 'uuid-1', shipment_id: '1016010610', operation_id: 'OP-1' }],
          };
        }
        if (text.includes('FROM shipments WHERE id')) {
          return {
            rows: [
              {
                status: 'PLANNED',
                shipment_id: '1016010610',
                operation_id: 'OP-1',
                daily_deliverables: null,
              },
            ],
          };
        }
        if (text.includes('FROM documents')) return { rows: [] };
        if (text.includes('user_sto_contract_assignments')) return { rows: [] };
        if (text.includes('latest_import')) {
          return { rows: [{ sto_key: '1016010610' }, { sto_key: '1016010636' }] };
        }
        return { rows: [] };
      }));

    await expect(
      findKlipPlannedStoSupersedeCandidate(db, contractUuid, '1016010636', '1011002977'),
    ).resolves.toBeNull();
  });
});

describe('finalizeSapShipmentAfterUpsert', () => {
  it('renames keeper and cancels SAP-only numeric ghost siblings', async () => {
    const keeperUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const contractUuid = '11111111-2222-3333-4444-555555555555';
    const ghostUuid = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
    const updates: string[] = [];

    const db = mockDb(vi.fn(async (text: string, params?: unknown[]) => {
        if (text.includes('SELECT shipment_id FROM shipments WHERE id')) {
          return { rows: [{ shipment_id: '1016010976' }] };
        }
        if (text.includes('UPDATE shipments SET shipment_id')) {
          updates.push(`rename:${params?.[0]}`);
          return { rows: [] };
        }
        if (text.includes('UPDATE contracts SET sto_number')) return { rows: [] };
        if (text.includes('SELECT po_number FROM contracts')) {
          return { rows: [{ po_number: '1011003113' }] };
        }
        if (text.includes('SELECT id, shipment_id FROM shipments') && text.includes('<> $2::uuid')) {
          return { rows: [{ id: ghostUuid, shipment_id: '1016010976' }] };
        }
        if (text.includes('FROM shipments WHERE id = $1') && text.includes('operation_id')) {
          const id = params?.[0];
          if (id === ghostUuid) {
            return { rows: [{ shipment_id: '1016010976', operation_id: null, daily_deliverables: null }] };
          }
          return { rows: [] };
        }
        if (text.includes('latest_import')) {
          return { rows: [{ sto_key: '1016010973' }] };
        }
        if (text.includes("status = 'CANCELLED'")) {
          updates.push(`cancel:${params?.[0]}`);
          return { rows: [] };
        }
        if (text.includes('DELETE FROM contract_stos')) {
          updates.push(`delete_sto:${params?.[1]}`);
          return { rows: [] };
        }
        return { rows: [] };
      }));

    const result = await finalizeSapShipmentAfterUpsert(
      db,
      contractUuid,
      keeperUuid,
      '1016010973',
      '1011003113',
    );

    expect(result.cancelledShipmentIds).toEqual([ghostUuid]);
    expect(updates.some((u) => u === 'rename:1016010973')).toBe(true);
    expect(updates.some((u) => u === `cancel:${ghostUuid}`)).toBe(true);
    expect(updates.some((u) => u === 'delete_sto:1016010976')).toBe(true);
  });

  it('does not rename keeper when parallel SAP STOs both exist in latest import', async () => {
    const keeperUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const contractUuid = '11111111-2222-3333-4444-555555555555';
    const updates: string[] = [];

    const db = mockDb(vi.fn(async (text: string, params?: unknown[]) => {
        if (text.includes('SELECT shipment_id FROM shipments WHERE id')) {
          return { rows: [{ shipment_id: '1586004927' }] };
        }
        if (text.includes('UPDATE shipments SET shipment_id')) {
          updates.push(`rename:${params?.[0]}`);
          return { rows: [] };
        }
        if (text.includes('UPDATE contracts SET sto_number')) {
          updates.push(`sync_sto:${params?.[0]}`);
          return { rows: [] };
        }
        if (text.includes('SELECT po_number FROM contracts')) {
          return { rows: [{ po_number: '1581000931' }] };
        }
        if (text.includes('SELECT id, shipment_id FROM shipments') && text.includes('<> $2::uuid')) {
          return { rows: [] };
        }
        if (text.includes('latest_import')) {
          return {
            rows: [{ sto_key: '1586004927' }, { sto_key: '1586004928' }, { sto_key: '1586004929' }],
          };
        }
        return { rows: [] };
      }));

    const result = await finalizeSapShipmentAfterUpsert(
      db,
      contractUuid,
      keeperUuid,
      '1586004928',
      '1581000931',
    );

    expect(result.cancelledShipmentIds).toEqual([]);
    expect(updates.some((u) => u.startsWith('rename:'))).toBe(false);
    expect(updates.some((u) => u.startsWith('sync_sto:'))).toBe(false);
  });

  it('skips ghost sibling with KLIP activity', async () => {
    const keeperUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const contractUuid = '11111111-2222-3333-4444-555555555555';
    const ghostUuid = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';

    const db = mockDb(vi.fn(async (text: string, params?: unknown[]) => {
        if (text.includes('SELECT shipment_id FROM shipments WHERE id')) {
          return { rows: [{ shipment_id: '1016010976' }] };
        }
        if (text.includes('UPDATE shipments SET shipment_id')) return { rows: [] };
        if (text.includes('UPDATE contracts SET sto_number')) return { rows: [] };
        if (text.includes('SELECT po_number FROM contracts')) {
          return { rows: [{ po_number: '1011003113' }] };
        }
        if (text.includes('SELECT id, shipment_id FROM shipments') && text.includes('<> $2::uuid')) {
          return { rows: [{ id: ghostUuid, shipment_id: '1016010976' }] };
        }
        if (text.includes('FROM shipments WHERE id = $1')) {
          const id = params?.[0];
          if (id === ghostUuid) {
            return {
              rows: [{ shipment_id: '1016010976', operation_id: 'OP-OLD', daily_deliverables: null }],
            };
          }
          return { rows: [] };
        }
        if (text.includes('latest_import')) {
          return { rows: [{ sto_key: '1016010973' }] };
        }
        return { rows: [] };
      }));

    const result = await finalizeSapShipmentAfterUpsert(
      db,
      contractUuid,
      keeperUuid,
      '1016010973',
      '1011003113',
    );

    expect(result.cancelledShipmentIds).toEqual([]);
    expect(result.skippedShipmentIds).toEqual([ghostUuid]);
  });
});

describe('fetchLatestSapStoKeysForPo', () => {
  it('returns distinct STO keys from mocked SAP query', async () => {
    const db = mockDb(vi.fn().mockResolvedValue({
      rows: [{ sto_key: '1016010973' }],
    }));
    await expect(fetchLatestSapStoKeysForPo(db, '1011003113')).resolves.toEqual(['1016010973']);
  });

  it('queries with STO Type T excluded for SEA supersede', async () => {
    const queryFn = vi.fn().mockResolvedValue({
      rows: [{ sto_key: '1016010973' }],
    });
    const db = mockDb(queryFn);
    await fetchLatestSapStoKeysForPo(db, '1011003113');
    const sql = String(queryFn.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain("<> 'T'");
    expect(sql).toContain('STO Type');
  });
});

describe('reconcileSupersededNumericStoSiblings', () => {
  it('is exported and callable', async () => {
    const db = mockDb(vi.fn().mockResolvedValue({ rows: [] }));
    const result = await reconcileSupersededNumericStoSiblings(
      db,
      '11111111-2222-3333-4444-555555555555',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      '1016010973',
    );
    expect(result.cancelled).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe('finalizeSapTruckingAfterUpsert', () => {
  it('returns empty cancel lists (upsert-only, aligned with shipment import)', async () => {
    const { finalizeSapTruckingAfterUpsert } = await import('./klipLogisticsActivity');
    const fakeDb = mockDb(async () => ({ rows: [] }));
    const result = await finalizeSapTruckingAfterUpsert(fakeDb, 'contract-uuid', 'trucking-uuid');
    expect(result.cancelledTruckingIds).toEqual([]);
    expect(result.skippedTruckingIds).toEqual([]);
  });
});
