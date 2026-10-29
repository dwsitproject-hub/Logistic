import { afterEach, describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { checkJpsReadiness, classifyPayloadProblem, resolveStoKeyForShipment, samePayloadIgnoringReference } from './readiness';

describe('classifyPayloadProblem: which page fixes what the payload builder holds back', () => {
  it('points at the master page that owns the missing code', () => {
    expect(classifyPayloadProblem('discharge port has no DHM code on Master Port').fixAt).toBe('master_port');
    expect(classifyPayloadProblem('discharge port was deleted in DHM (Master Port)').fixAt).toBe('master_port');
    expect(classifyPayloadProblem('no DHM code on Master Vessel for "BG. X"').fixAt).toBe('master_vessel');
    expect(classifyPayloadProblem('Master Vessel "BG. X" was deleted in DHM').fixAt).toBe('master_vessel');
    expect(classifyPayloadProblem('no DHM code on Master Product for "POME"').fixAt).toBe('master_product');
    expect(classifyPayloadProblem('Master Product "POME" was deleted in DHM').fixAt).toBe('master_product');
  });

  it('points at the shipment for ETA, and at SAP for quantities', () => {
    expect(classifyPayloadProblem('ETA discharge arrival is empty').fixAt).toBe('shipment');
    expect(classifyPayloadProblem('contract 1004 has no STO quantity').fixAt).toBe('sap');
    expect(classifyPayloadProblem('contract 1004: STO qty 10 MT exceeds contract qty 5 MT by more than 10%').fixAt).toBe('sap');
  });

  it('always gives the user something to do', () => {
    for (const p of ['something unexpected', 'no DHM code on Master Vessel for "X"']) {
      expect(classifyPayloadProblem(p).fix.length).toBeGreaterThan(10);
    }
  });
});

describe('checkJpsReadiness (read-only, against the database)', () => {
  it('lists each requirement with what was found, and writes nothing', async () => {
    const pick = await query(
      `SELECT s.id FROM shipments s JOIN contracts c ON c.id = s.contract_id
        WHERE COALESCE(s.status, '') NOT IN ('CANCELLED') ORDER BY s.created_at DESC LIMIT 1`,
    );
    const id = pick.rows[0]?.id as string | undefined;
    if (!id) return;
    const before = await query(`SELECT COUNT(*)::int AS n FROM jps_shipping_instructions`);

    const r = await checkJpsReadiness(id);
    expect(r.stoKey).toBe(await resolveStoKeyForShipment(id));
    expect(r.checks.find((c) => c.key === 'integration')).toBeTruthy();
    expect(typeof r.canSubmit).toBe('boolean');
    // a check that fails always says what to do about it
    for (const c of r.checks.filter((x) => !x.ok && x.key !== 'shipment')) expect(c.fix ?? c.value).toBeTruthy();
    // it cannot be submittable while any requirement fails
    // (an instruction JPS rejected is the one SUBMITTED row that can be sent again, as a new revision)
    const heldByJps = r.tracker?.state === 'SUBMITTED' && !['Rejected', 'Deleted'].includes(String(r.tracker.jpsStatus));
    expect(r.canSubmit).toBe(r.checks.every((c) => c.ok) && !heldByJps);

    const after = await query(`SELECT COUNT(*)::int AS n FROM jps_shipping_instructions`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  }, 120_000);

  it('never offers an STO JPS already holds', async () => {
    const held = await query(
      `SELECT s.id FROM shipments s
         JOIN contracts c ON c.id = s.contract_id
         LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
         JOIN jps_shipping_instructions j ON j.sto_key = COALESCE(NULLIF(TRIM(s.shipment_id), ''), NULLIF(TRIM(s.operation_id), '')) AND j.state = 'SKIPPED_PRE_EXISTING'
        LIMIT 1`,
    );
    const id = held.rows[0]?.id as string | undefined;
    if (!id) return;
    const r = await checkJpsReadiness(id);
    expect(r.canSubmit).toBe(false);
    expect(r.reason).toBeTruthy();
  }, 120_000);
});

describe('samePayloadIgnoringReference: does a resubmission repeat what JPS rejected', () => {
  const base = {
    external_reference: 'KLIP-1006020269-R1',
    vessel_hub_code: 'VSL-0179',
    cargo: [{ contract_no: 'C1', sto_quantity: 1000 }],
  };

  it('is the same when only the reference (the revision) differs, whatever the key order', () => {
    const next = { cargo: [{ sto_quantity: 1000, contract_no: 'C1' }], vessel_hub_code: 'VSL-0179', external_reference: 'KLIP-1006020269-R2' };
    expect(samePayloadIgnoringReference(base, next)).toBe(true);
  });

  it('is different as soon as anything JPS reads changed', () => {
    expect(samePayloadIgnoringReference(base, { ...base, vessel_hub_code: 'VSL-0180' })).toBe(false);
    expect(samePayloadIgnoringReference(base, { ...base, cargo: [{ contract_no: 'C1', sto_quantity: 900 }] })).toBe(false);
    expect(samePayloadIgnoringReference(base, { ...base, extra: 1 })).toBe(false);
  });
});

describe('checkJpsReadiness over the ports (Integrations > JPS > Ports), against the database', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  /** A shipment with a discharge Master Port, and that port's name. */
  async function shipmentWithPort() {
    const pick = await query(
      `SELECT s.id, mp.port
         FROM shipments s JOIN master_loading_ports mp ON mp.id = s.discharge_master_port_id
        WHERE COALESCE(s.status, '') NOT IN ('CANCELLED')
        ORDER BY s.created_at DESC LIMIT 1`,
    );
    return { id: pick.rows[0]?.id as string | undefined, port: pick.rows[0]?.port as string | undefined };
  }
  const settled = (r: Awaited<ReturnType<typeof checkJpsReadiness>>) => r.tracker?.state === 'SUBMITTED' || r.tracker?.state === 'SKIPPED_PRE_EXISTING';

  it('a port that is listed but not switched on says so, names where to switch it on, and cannot be submitted', async () => {
    const { id, port } = await shipmentWithPort();
    if (!id || !port) return;
    process.env.JPS_PORTS = JSON.stringify([{ port: 'PORT SOMEWHERE ELSE', enabled: true }, { port, enabled: false }]);
    const r = await checkJpsReadiness(id);
    if (settled(r)) return;
    const check = r.checks.find((c) => c.key === 'discharge_port');
    expect(check).toMatchObject({ ok: false, fixAt: 'settings' });
    expect(check?.fix).toContain('Integrations > JPS > Ports');
    expect(check?.fix).toContain('switches it on');
    expect(r.canSubmit).toBe(false);
  }, 120_000);

  it('a port switched on passes, whatever Region/Site the contracts carry', async () => {
    const { id, port } = await shipmentWithPort();
    if (!id || !port) return;
    process.env.JPS_PORTS = JSON.stringify([{ port, enabled: true }]);
    const r = await checkJpsReadiness(id);
    if (settled(r)) return;
    expect(r.checks.find((c) => c.key === 'discharge_port')).toMatchObject({ ok: true });
    expect(r.checks.find((c) => c.key === 'region')).toBeUndefined();
    expect(r.checks.find((c) => c.key === 'port_enabled')).toBeUndefined();
  }, 120_000);

  it('a port that is not listed at all says an ADMIN adds it, and which ports are on now', async () => {
    const { id } = await shipmentWithPort();
    if (!id) return;
    process.env.JPS_PORTS = JSON.stringify([{ port: 'PORT SOMEWHERE ELSE', enabled: true }]);
    const r = await checkJpsReadiness(id);
    if (settled(r)) return;
    const check = r.checks.find((c) => c.key === 'discharge_port');
    expect(check).toMatchObject({ ok: false, fixAt: 'settings' });
    expect(check?.fix).toContain('PORT SOMEWHERE ELSE');
    expect(check?.fix).toContain('synced with DHM');
  }, 120_000);

  it('with no port switched on (nothing is built into the code) it says so, and cannot be submitted', async () => {
    const { id } = await shipmentWithPort();
    if (!id) return;
    process.env.JPS_PORTS = '[]';
    const r = await checkJpsReadiness(id);
    if (settled(r)) return;
    expect(r.canSubmit).toBe(false);
    expect(r.reason).toBe('No port is switched on for JPS.');
    expect(r.checks.find((c) => c.key === 'port_enabled')).toMatchObject({ ok: false, fixAt: 'settings' });
  }, 120_000);
});

describe('samePayloadIgnoringReference: who asked is not part of what JPS judges', () => {
  it('the sweep (sap-data-import) and a user pressing the button (an email) send the same instruction', () => {
    const a = { external_reference: 'KLIP-1-R1', requested_by: 'sap-data-import', vessel_hub_code: 'VSL-0179' };
    const b = { external_reference: 'KLIP-1-R2', requested_by: 'budi.santoso@kpn.com', vessel_hub_code: 'VSL-0179' };
    expect(samePayloadIgnoringReference(a, b)).toBe(true);
    expect(samePayloadIgnoringReference(a, { ...b, vessel_hub_code: 'VSL-0180' })).toBe(false);
  });
});
