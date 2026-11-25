import { afterAll, describe, expect, it } from 'vitest';
import pool from '../database/connection';
import { findB2bOriginPlannedShipmentForSto } from './klipLogisticsActivity';

/**
 * MT. ARCADIA, production 2026-11-18: SAP booked STO 1006021152 on the B2B CHILD 1004033142 while the KLIP plan (MNL-...) sat on the ORIGIN 9144101942, so SAP inserted a second row.
 * Read-only, against the database: the SQL of the finder has to RUN (a string-only test passes while the query cannot), and it has to find the plan through the B2B link.
 * The case is searched in the data (a B2B child whose origin has a KLIP plan MNL-/MSEA- that is not cancelled or completed) and the second test is skipped when there is none.
 */
const same = (a: string, b: string) => (a.trim().toUpperCase() === b.trim().toUpperCase() ? 1 : 0);

describe('the KLIP plan on the B2B origin is found for the child (against the database)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('the finder SQL runs, and a contract without a B2B link finds nothing', async () => {
    const any = await pool.query(`SELECT id::text AS id FROM contracts LIMIT 1`);
    if (any.rows.length === 0) return;
    await expect(findB2bOriginPlannedShipmentForSto(pool, any.rows[0].id, '1009999999', 'NO SUCH VESSEL', same)).resolves.toBeNull();
  });

  it('finds the plan of the origin through the B2B link, and not for an unrelated vessel', async () => {
    const pick = await pool.query(
      `SELECT c.id::text AS child_uuid, s.id::text AS plan_id, s.vessel_name,
              (SELECT count(*) FROM shipments s2
                 WHERE s2.contract_id = oc.id AND UPPER(COALESCE(s2.status, '')) NOT IN ('CANCELLED', 'CANCELED', 'COMPLETED')
                   AND (s2.shipment_id LIKE 'MNL-%' OR s2.shipment_id LIKE 'MSEA-%'))::int AS plans
         FROM contracts c
         JOIN contract_latest_spd_snapshot chb
           ON chb.contract_number = c.contract_id AND UPPER(COALESCE(chb.b2b_flag_raw, '')) = 'B2B' AND NULLIF(TRIM(chb.contract_reference_po_raw), '') IS NOT NULL
         JOIN contracts oc ON TRIM(oc.po_number::text) = TRIM(chb.contract_reference_po_raw) AND oc.id <> c.id
         JOIN shipments s ON s.contract_id = oc.id
        WHERE UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED', 'COMPLETED')
          AND (s.shipment_id LIKE 'MNL-%' OR s.shipment_id LIKE 'MSEA-%')
          AND NULLIF(TRIM(s.vessel_name), '') IS NOT NULL
        ORDER BY 4 ASC
        LIMIT 1`,
    );
    if (pick.rows.length === 0) return; // nothing of this shape in this database
    const { child_uuid: child, plan_id: plan, vessel_name: vessel, plans } = pick.rows[0] as { child_uuid: string; plan_id: string; vessel_name: string; plans: number };

    if (plans === 1) {
      await expect(findB2bOriginPlannedShipmentForSto(pool, child, '1009999999', vessel, same)).resolves.toBe(plan);
    }
    await expect(findB2bOriginPlannedShipmentForSto(pool, child, '1009999999', 'ZZ NO SUCH VESSEL', same)).resolves.toBeNull();
  });
});
