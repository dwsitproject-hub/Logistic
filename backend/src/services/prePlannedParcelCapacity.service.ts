import { query } from '../database/connection';
import { getPrePlannedConfig } from '../config/prePlannedConfig';
import logger from '../utils/logger';
import { groupPlantExpr } from '../utils/groupPlantSql';

const MIN_BL_MT = 100;

export async function refreshPrePlannedParcelCapacity(): Promise<void> {
  const cfg = getPrePlannedConfig();
  const plantExpr = groupPlantExpr('c.plant_code', 'c.company_name');
  const result = await query(
    `
    WITH hist AS (
      SELECT
        ${plantExpr} AS group_plant,
        s.bl_quantity / 1000.0 AS bl_mt
      FROM shipments s
      INNER JOIN contracts c ON c.id = s.contract_id
      WHERE s.bl_quantity IS NOT NULL
        AND s.bl_quantity / 1000.0 >= $1
        AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED')
        AND ${plantExpr} NOT IN ('Blank', 'Trading')
    ),
    agg AS (
      SELECT
        group_plant,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bl_mt) AS parcel_mt,
        COUNT(*)::int AS sample_count
      FROM hist
      GROUP BY group_plant
    )
    SELECT group_plant, parcel_mt::text, sample_count::text FROM agg
    `,
    [MIN_BL_MT],
  );

  for (const row of result.rows) {
    const sampleCount = Number(row.sample_count);
    const parcelMt =
      sampleCount >= cfg.parcelMinSamples
        ? Number(row.parcel_mt)
        : cfg.parcelFallbackMt;
    await query(
      `
      INSERT INTO pre_planned_parcel_capacity (group_plant, parcel_mt, sample_count, refreshed_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (group_plant) DO UPDATE SET
        parcel_mt = EXCLUDED.parcel_mt,
        sample_count = EXCLUDED.sample_count,
        refreshed_at = now()
      `,
      [row.group_plant, parcelMt, sampleCount],
    );
  }

  logger.info('Pre-planned parcel capacity refreshed', { plants: result.rows.length });
}

export async function getParcelMtForPlant(groupPlant: string): Promise<number> {
  const cfg = getPrePlannedConfig();
  const res = await query(
    `SELECT parcel_mt::text FROM pre_planned_parcel_capacity WHERE group_plant = $1`,
    [groupPlant],
  );
  if (res.rows[0]) {
    return Number(res.rows[0].parcel_mt);
  }
  return cfg.parcelFallbackMt;
}

export async function loadParcelCapacityMap(): Promise<Map<string, number>> {
  const cfg = getPrePlannedConfig();
  const res = await query(
    `SELECT group_plant, parcel_mt::text FROM pre_planned_parcel_capacity`,
  );
  const map = new Map<string, number>();
  for (const row of res.rows) {
    map.set(row.group_plant, Number(row.parcel_mt));
  }
  map.set('__fallback__', cfg.parcelFallbackMt);
  return map;
}

export function resolveParcelMt(map: Map<string, number>, groupPlant: string): number {
  return map.get(groupPlant) ?? map.get('__fallback__') ?? getPrePlannedConfig().parcelFallbackMt;
}
