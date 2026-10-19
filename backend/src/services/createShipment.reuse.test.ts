import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const activityMock = vi.hoisted(() => vi.fn());
vi.mock('../database/connection', () => ({ query: queryMock, default: { query: queryMock } }));
vi.mock('../utils/klipLogisticsActivity', () => ({ hasKlipShipmentActivity: activityMock }));

import { findReusableShipmentForPlan } from './createShipment.service';

const CONTRACT = '11111111-1111-1111-1111-111111111111';

/** Answers each of the helper's three lookups from a table, matched by the SQL it sends. */
function answer(opts: { byOp?: string[]; byVessel?: string[]; candidates?: string[] }) {
  queryMock.mockImplementation(async (sql: string) => {
    const flat = String(sql).replace(/\s+/g, ' ');
    if (flat.includes('operation_id = $2')) return { rows: (opts.byOp ?? []).map((id) => ({ id })) };
    if (flat.includes('LOWER(TRIM(s.vessel_name))')) return { rows: (opts.byVessel ?? []).map((id) => ({ id })) };
    if (flat.includes('ORDER BY created_at DESC')) return { rows: (opts.candidates ?? []).map((id) => ({ id })) };
    throw new Error('unexpected query: ' + flat.slice(0, 80));
  });
}

describe('findReusableShipmentForPlan', () => {
  beforeEach(() => {
    queryMock.mockReset();
    activityMock.mockReset();
  });

  it('re-submitting a plan under the same operation reuses that row', async () => {
    answer({ byOp: ['same-op'] });
    await expect(findReusableShipmentForPlan({ contractUuid: CONTRACT, operationId: 'OP-1', vesselName: 'A' })).resolves.toBe('same-op');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('a second plan for the PO on ANOTHER vessel and operation gets a row of its own, even though a shipment of the contract exists', async () => {
    // PO 1001031313: Dahlia (planned by a user, completed), then a new plan on Kapuas 168 under a new operation
    answer({ candidates: ['dahlia-shipment'] });
    activityMock.mockResolvedValue(true); // the Dahlia shipment was planned in KLIP (operation id given by a user)
    await expect(findReusableShipmentForPlan({ contractUuid: CONTRACT, operationId: 'OP-NEW', vesselName: 'KAPUAS 168' })).resolves.toBeNull();
    expect(activityMock).toHaveBeenCalledWith(expect.anything(), 'dahlia-shipment', CONTRACT);
  });

  it('the shell the SAP import made for the PO (no user activity) is still filled in by the first plan', async () => {
    answer({ candidates: ['sap-shell'] });
    activityMock.mockResolvedValue(false);
    await expect(findReusableShipmentForPlan({ contractUuid: CONTRACT, operationId: 'OP-NEW', vesselName: 'X' })).resolves.toBe('sap-shell');
  });

  it('skips a touched row and takes the first untouched one, newest first', async () => {
    answer({ candidates: ['touched-newest', 'shell-older'] });
    activityMock.mockImplementation(async (_db: unknown, id: string) => id === 'touched-newest');
    await expect(findReusableShipmentForPlan({ contractUuid: CONTRACT, operationId: 'OP-NEW' })).resolves.toBe('shell-older');
  });

  it('never reuses a finished voyage just because the vessel name matches', async () => {
    answer({});
    await findReusableShipmentForPlan({ contractUuid: CONTRACT, operationId: 'OP-NEW', vesselName: 'DAHLIA' });
    const vesselSql = String(queryMock.mock.calls.find(([sql]) => String(sql).includes('LOWER(TRIM(s.vessel_name))'))?.[0]).replace(/\s+/g, ' ');
    expect(vesselSql).toContain("UPPER(TRIM(COALESCE(s.status, ''))) <> 'COMPLETED'");
    expect(vesselSql).toContain('s.ata_discharge_complete IS NULL');
    expect(vesselSql).toContain('shipment_ata_overrides');
    expect(vesselSql).toContain('o.ata_discharge_complete IS NOT NULL');
  });

  it('uses no operation lookup when there is no operation id', async () => {
    answer({});
    await findReusableShipmentForPlan({ contractUuid: CONTRACT, operationId: null, vesselName: null });
    expect(queryMock.mock.calls.every(([sql]) => !String(sql).includes('operation_id = $2'))).toBe(true);
  });
});
