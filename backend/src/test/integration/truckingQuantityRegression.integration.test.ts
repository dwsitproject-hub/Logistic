import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../server';
import { query } from '../../database/connection';
import { clearTruckingListMemoryCaches } from '../../services/truckingList.service';
import { TRUCKING_PIPELINE_SUMMARY_LOGIC_VERSION } from '../../services/pipelineDailySummary.service';
import {
  seedTruckingQtyFixtures,
  TRUCKING_QTY_CONTRACT_DATE,
  TRUCKING_QTY_DATE_FROM,
  TRUCKING_QTY_DATE_TO,
  TRUCKING_QTY_EXPECTED,
  TRUCKING_QTY_EXPECTED_STAGE,
  TRUCKING_QTY_SUMMARY_TOTALS,
} from './truckingQtySeedFixtures';

/**
 * Golden-value regression suite for Trucking delivery/receive/outstanding quantities.
 *
 * Purpose: lock in today's correct numbers so the planned rewrite of the SAP delivery/receive
 * resolution SQL (converting per-row correlated subqueries in
 * `sqlTruckingPoLevelSapQtyWithDedup` into a pre-aggregated CTE + join) can be verified against
 * real computed values, not just SQL-text assertions (see `truckingQuantitySql.test.ts`, which
 * only checks generated SQL text and would not catch a behavior change).
 *
 * If a rewrite changes a number here, that is a regression — fix the rewrite. If a baseline
 * itself turns out to be wrong, that's a separate conversation before changing the expected value
 * (see `truckingQtySeedFixtures.ts` for the hand-computed derivation of each expected value).
 */

let token: string;

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.data.token as string;
}

beforeAll(async () => {
  await seedTruckingQtyFixtures();
  await query(
    `UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'trucking'`,
  );
  clearTruckingListMemoryCaches();
  token = await login('admin@klip.com', 'admin123');
}, 60000);

describe('Integration: Trucking quantity regression — list endpoint (STO expansion + dedup)', () => {
  for (const [contractId, expected] of Object.entries(TRUCKING_QTY_EXPECTED)) {
    it(`GET /api/trucking row for ${contractId} matches expected delivered/receive/outstanding`, async () => {
      const res = await request(app)
        .get(
          `/api/trucking?skipSapJoin=false&includeSummary=false&limit=5&page=1&sortKey=supplier&sortDir=asc&contract=${encodeURIComponent(
            contractId,
          )}`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const rows = res.body.data.truckingOperations as Array<Record<string, unknown>>;
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(Number(row.quantity_delivered)).toBe(expected.quantityDelivered);
      expect(Number(row.quantity_receive)).toBe(expected.quantityReceive);
      expect(Number(row.outstanding_quantity)).toBe(expected.outstandingQuantity);
    });
  }
});

describe('Integration: Trucking quantity regression — summary endpoint (STO expansion + dedup)', () => {
  it('summary aggregates (statusContractQty / statusOutstandingQty / outstandingQty) match hand-computed totals', async () => {
    const res = await request(app)
      .get(
        `/api/trucking?summaryOnly=true&limit=1&page=1&sortKey=supplier&sortDir=asc&dateFrom=${TRUCKING_QTY_DATE_FROM}&dateTo=${TRUCKING_QTY_DATE_TO}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const summary = res.body.data.summary as {
      statusContractQty: { planned: number; completed: number };
      statusOutstandingQty: { unplanned: number; planned: number; inProgress: number };
      outstandingQty: {
        totalKg: number;
        thirdParty: { frcKg: number; lcoKg: number };
        interco: { frcKg: number; lcoKg: number };
      };
    };

    expect(Number(summary.statusContractQty.planned)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.plannedContractQtyKg,
    );
    expect(Number(summary.statusContractQty.completed)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.completedContractQtyKg,
    );
    expect(Number(summary.statusOutstandingQty.planned)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.plannedOutstandingQtyKg,
    );
    expect(Number(summary.statusOutstandingQty.inProgress)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.inProgressOutstandingQtyKg,
    );
    expect(Number(summary.statusOutstandingQty.unplanned)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.unplannedOutstandingQtyKg,
    );
    expect(Number(summary.outstandingQty.totalKg)).toBe(TRUCKING_QTY_SUMMARY_TOTALS.outstandingQty.totalKg);
    expect(Number(summary.outstandingQty.thirdParty.frcKg)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.outstandingQty.thirdParty.frcKg,
    );
    expect(Number(summary.outstandingQty.thirdParty.lcoKg)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.outstandingQty.thirdParty.lcoKg,
    );
    expect(Number(summary.outstandingQty.interco.frcKg)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.outstandingQty.interco.frcKg,
    );
    expect(Number(summary.outstandingQty.interco.lcoKg)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.outstandingQty.interco.lcoKg,
    );
  }, 30000);

  it('per-PO summary OS strip (via contract filter) matches dedup/WB/GR-Close branches', async () => {
    for (const [contractId, expected] of Object.entries(TRUCKING_QTY_EXPECTED)) {
      const res = await request(app)
        .get(
          `/api/trucking?skipSapJoin=false&includeSummary=true&limit=5&page=1&sortKey=supplier&sortDir=asc&contract=${encodeURIComponent(
            contractId,
          )}&dateFrom=${TRUCKING_QTY_DATE_FROM}&dateTo=${TRUCKING_QTY_DATE_TO}`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const summary = res.body.data.summary as {
        outstandingQty: { totalKg: number };
      };
      // Single-contract scope: the OS strip only includes UNPLANNED/PLANNED/IN_PROGRESS stages
      // (GR-Closed POs — COMPLETED — are intentionally excluded from the active OS strip).
      const isActiveStage = TRUCKING_QTY_EXPECTED_STAGE[contractId] !== 'COMPLETED';
      expect(Number(summary.outstandingQty.totalKg)).toBe(
        isActiveStage ? expected.outstandingQuantity : 0,
      );
    }
  }, 60000);
});

describe('Integration: Trucking quantity regression — GR-Close snapshot + GR-Open live hybrid', () => {
  async function seedGrClosedSnapshotRow(): Promise<void> {
    await query(
      `DELETE FROM trucking_pipeline_daily_summary
        WHERE contract_date BETWEEN $1::date AND $2::date`,
      [TRUCKING_QTY_DATE_FROM, TRUCKING_QTY_DATE_TO],
    );
    await query(
      `INSERT INTO trucking_pipeline_daily_summary (
         group_plant, contract_date, product, incoterm,
         total_count, unplanned_execution_count, planned_count, in_progress_count,
         loading_count, in_transit_count, unloading_count, completed_count, cancelled_count,
         unplanned_contract_backlog,
         completed_gr_closed_contract_qty, cancelled_gr_closed_contract_qty
       ) VALUES (
         'Blank', $1::date, 'CPO', 'LCO',
         8, 0, 5, 0,
         0, 0, 0, 2, 0,
         0,
         600000, 0
       )`,
      [TRUCKING_QTY_CONTRACT_DATE],
    );
    await query(
      `UPDATE pipeline_summary_refresh_meta
          SET is_stale = FALSE, logic_version = $1, refreshed_at = NOW()
        WHERE module = 'trucking'`,
      [TRUCKING_PIPELINE_SUMMARY_LOGIC_VERSION],
    );
    clearTruckingListMemoryCaches();
  }

  afterAll(async () => {
    await query(
      `DELETE FROM trucking_pipeline_daily_summary
        WHERE contract_date BETWEEN $1::date AND $2::date`,
      [TRUCKING_QTY_DATE_FROM, TRUCKING_QTY_DATE_TO],
    );
    await query(
      `UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'trucking'`,
    );
    clearTruckingListMemoryCaches();
  });

  it('hybrid summaryOnly matches live delivery/receive/OS totals (no double-count of GR-Close qty)', async () => {
    await seedGrClosedSnapshotRow();
    const res = await request(app)
      .get(
        `/api/trucking?summaryOnly=true&limit=1&page=1&sortKey=supplier&sortDir=asc&dateFrom=${TRUCKING_QTY_DATE_FROM}&dateTo=${TRUCKING_QTY_DATE_TO}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const summary = res.body.data.summary as {
      statusContractQty: { planned: number; completed: number };
      statusOutstandingQty: { unplanned: number; planned: number; inProgress: number };
      outstandingQty: {
        totalKg: number;
        thirdParty: { frcKg: number; lcoKg: number };
        interco: { frcKg: number; lcoKg: number };
      };
    };

    expect(Number(summary.statusContractQty.planned)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.plannedContractQtyKg,
    );
    expect(Number(summary.statusContractQty.completed)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.completedContractQtyKg,
    );
    expect(Number(summary.statusOutstandingQty.planned)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.plannedOutstandingQtyKg,
    );
    expect(Number(summary.statusOutstandingQty.inProgress)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.inProgressOutstandingQtyKg,
    );
    expect(Number(summary.statusOutstandingQty.unplanned)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.unplannedOutstandingQtyKg,
    );
    expect(Number(summary.outstandingQty.totalKg)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.outstandingQty.totalKg,
    );
    expect(Number(summary.outstandingQty.thirdParty.frcKg)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.outstandingQty.thirdParty.frcKg,
    );
    expect(Number(summary.outstandingQty.thirdParty.lcoKg)).toBe(
      TRUCKING_QTY_SUMMARY_TOTALS.outstandingQty.thirdParty.lcoKg,
    );
  }, 30000);
});
