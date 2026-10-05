import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, pool: {} }));

import { upsertShipmentAtaOverride } from './shipmentAtaOverride.service';

describe('clearing the KLIP ATA keeps what JPS reported on the same row', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id, shipment_id/.test(sql)) {
        return { rows: [{ id: 'o1', shipment_id: 's1', ata_discharge_arrival: '2026-09-28', source: 'manual' }] };
      }
      return { rows: [] };
    });
  });

  it('blanks the KLIP columns, then drops the row only when no JPS value is on it', async () => {
    const result = await upsertShipmentAtaOverride(queryMock as never, 's1', { ata_vessel_arrive_at_discharge_port: null });
    expect(result).toBeNull();
    const writes = queryMock.mock.calls.map((c) => String(c[0])).filter((sql) => !/^\s*SELECT/.test(sql));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatch(/UPDATE shipment_ata_overrides\s+SET ata_arrival = NULL/);
    expect(writes[0]).not.toContain('jps_ata_discharge');
    expect(writes[1]).toMatch(/DELETE FROM shipment_ata_overrides/);
    for (const col of ['arrival', 'berthed', 'start', 'complete']) {
      expect(writes[1]).toContain(`jps_ata_discharge_${col} IS NULL`);
    }
  });
});
