import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { checkJpsReadiness, classifyPayloadProblem, resolveStoKeyForShipment } from './readiness';

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
    expect(r.canSubmit).toBe(r.checks.every((c) => c.ok) && (r.tracker?.state ?? '') !== 'SUBMITTED');

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
