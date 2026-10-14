import { describe, expect, it } from 'vitest';
import { hasKlipShipmentActivity } from './klipLogisticsActivity';

function mockDb(queryFn: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) {
  return { query: queryFn, release: () => undefined };
}

const SHIPMENT = '11111111-2222-3333-4444-555555555555';

type Row = { shipment_id: string; operation_id: string | null; operation_id_source: string | null; daily_deliverables?: unknown };

/** A db that answers the row read and "nothing" to every other probe, unless `extra` says otherwise. */
function activityDb(row: Row, extra: { auditUpdate?: boolean; documents?: boolean } = {}) {
  return mockDb(async (text: string) => {
    if (/FROM shipments WHERE id/.test(text)) return { rows: [{ daily_deliverables: null, ...row }] };
    if (/FROM audit_logs/.test(text)) return { rows: extra.auditUpdate ? [{ one: 1 }] : [] };
    if (/FROM documents/.test(text)) return { rows: extra.documents ? [{ one: 1 }] : [] };
    return { rows: [] };
  });
}

describe('hasKlipShipmentActivity and the operation id KLIP assigned to a SAP shell', () => {
  it('an operation id a USER planned (no marker) still means KLIP activity', async () => {
    const db = activityDb({ shipment_id: '1006018854', operation_id: 'OP-SEA-030920260454', operation_id_source: null });
    expect(await hasKlipShipmentActivity(db, SHIPMENT)).toBe(true);
  });

  it('an operation id KLIP assigned to a SAP shell (SAP_IMPORT) is NOT activity: the SAP re-import must keep refreshing the row', async () => {
    const db = activityDb({ shipment_id: '1006018854', operation_id: 'OP-SEA-030920260454', operation_id_source: 'SAP_IMPORT' });
    expect(await hasKlipShipmentActivity(db, SHIPMENT)).toBe(false);
  });

  it('a SAP_IMPORT row a user then edited (audit UPDATE) is protected again', async () => {
    const db = activityDb(
      { shipment_id: '1006018854', operation_id: 'OP-SEA-030920260454', operation_id_source: 'SAP_IMPORT' },
      { auditUpdate: true },
    );
    expect(await hasKlipShipmentActivity(db, SHIPMENT)).toBe(true);
  });

  it('a SAP_IMPORT row with a document is protected', async () => {
    const db = activityDb(
      { shipment_id: '1006018854', operation_id: 'OP-SEA-030920260454', operation_id_source: 'SAP_IMPORT' },
      { documents: true },
    );
    expect(await hasKlipShipmentActivity(db, SHIPMENT)).toBe(true);
  });

  it('a SAP_IMPORT row with daily deliverables is protected', async () => {
    const db = activityDb({
      shipment_id: '1006018854',
      operation_id: 'OP-SEA-030920260454',
      operation_id_source: 'SAP_IMPORT',
      daily_deliverables: [{ date: '2026-10-01', qty: 100 }],
    });
    expect(await hasKlipShipmentActivity(db, SHIPMENT)).toBe(true);
  });

  it('a KLIP manual row (MNL-) is always activity, whatever the marker', async () => {
    const db = activityDb({ shipment_id: 'MNL-1700-1004029379', operation_id: 'OP-1', operation_id_source: 'SAP_IMPORT' });
    expect(await hasKlipShipmentActivity(db, SHIPMENT)).toBe(true);
  });

  it('a SAP shell with no id and no activity is not protected (as before)', async () => {
    const db = activityDb({ shipment_id: '1006018854', operation_id: null, operation_id_source: null });
    expect(await hasKlipShipmentActivity(db, SHIPMENT)).toBe(false);
  });
});
