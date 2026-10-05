/**
 * JPS's actual times, as the third lane of discharge ATA (SAP, KLIP, JPS).
 *
 * Which JPS actual feeds which KLIP milestone is decided in ONE place, JPS_SCHEDULE_ATA_FIELDS (scheduleAtaSql.ts):
 * ta -> ATA at DP, tb -> ATB, cargo_ops_start_at -> ATS Discharge, tc -> ATC Discharge.
 *
 * Stored on shipment_ata_overrides.jps_ata_discharge_*; the readers put them FIRST for a shipment that is not COMPLETED
 * (sqlJpsAtaWhileOpen in utils/shipmentAtaOverrideSql.ts), so a JPS value wins while the voyage is open and KLIP / SAP
 * answer whenever JPS has none. Written for every shipment of the STO, as a manual ATA is.
 */
import { query } from '../database/connection';
import { invalidateAfterShipmentWrite } from '../services/shipmentWriteInvalidation.service';
import { shipmentListStoKeyExpr } from '../utils/shipmentStoTypeSql';
import logger from '../utils/logger';
import { JPS_SCHEDULE_ATA_FIELDS } from './scheduleAtaSql';
import type { JpsSchedule } from './types';

/** The lane, derived from the one mapping in scheduleAtaSql.ts so the modal's JPS reference and the stored lane cannot drift. */
export const JPS_ATA_LANE = JPS_SCHEDULE_ATA_FIELDS.map((f) => ({
  schedule: f.scheduleKey,
  column: f.overrideColumn,
  klip: f.klip,
}));

export type JpsAtaLaneColumn = (typeof JPS_SCHEDULE_ATA_FIELDS)[number]['overrideColumn'];
export type JpsAtaLanePlan = Partial<Record<JpsAtaLaneColumn, string | null>>;

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * The calendar date of a JPS timestamp in Asia/Jakarta, 'YYYY-MM-DD'.
 *
 * JPS sends UTC and the ATA columns are dates, so 22:00Z on the 1st is already the 2nd at the port. Jakarta has no DST
 * (a fixed +07:00), so adding the offset and reading the UTC date is exact and does not depend on the ICU data of the
 * runtime.
 */
export function toJakartaDate(value: unknown): string | null {
  if (value == null || String(value).trim() === '') return null;
  const ms = new Date(String(value)).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * What the JPS lane should hold for this response.
 *
 * A field JPS did not send at all (`undefined`: a v5.3 response has no `cargo_ops_start_at`, a v4.x one has no schedule)
 * is left alone. A field sent as `null` is JPS saying "not logged", and clears the lane value, so a time an operator
 * took back does not linger in KLIP.
 */
export function planJpsAtaLane(schedule: JpsSchedule | null | undefined): JpsAtaLanePlan {
  const plan: JpsAtaLanePlan = {};
  if (!schedule) return plan;
  for (const { schedule: field, column } of JPS_ATA_LANE) {
    const raw = schedule[field];
    if (raw === undefined) continue;
    if (raw === null || String(raw).trim() === '') {
      plan[column] = null;
      continue;
    }
    const date = toJakartaDate(raw);
    if (date) plan[column] = date;
  }
  return plan;
}

/** The shipments of an STO, found the way the Shipments page and the eligibility query key them. */
async function shipmentIdsForStoKey(stoKey: string): Promise<string[]> {
  const result = await query(
    `SELECT DISTINCT s.id::text AS id
     FROM shipments s
     INNER JOIN contracts c ON c.id = s.contract_id
     LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
     WHERE ${shipmentListStoKeyExpr('c', 'l', 's')} = $1`,
    [stoKey],
  );
  return (result.rows as Array<{ id: string }>).map((r) => r.id);
}

export interface JpsAtaLaneResult {
  shipmentIds: string[];
  changedShipmentIds: string[];
}

/**
 * Put JPS's actual times on every shipment of the STO. Only shipments whose lane value really differs are written, and
 * only those are refreshed afterwards, so the poll that re-reads an unchanged instruction every few minutes costs one
 * SELECT.
 *
 * Idempotent and self-healing: it compares with what the lane holds, not with the previous poll, so a write that failed
 * once is simply made again by the next poll or webhook.
 */
export async function applyJpsAtaLane(
  stoKey: string,
  schedule: JpsSchedule | null | undefined,
  options: { dryRun?: boolean } = {},
): Promise<JpsAtaLaneResult> {
  const plan = planJpsAtaLane(schedule);
  const columns = Object.keys(plan) as JpsAtaLaneColumn[];
  const empty: JpsAtaLaneResult = { shipmentIds: [], changedShipmentIds: [] };
  if (columns.length === 0 || !stoKey) return empty;

  const shipmentIds = await shipmentIdsForStoKey(stoKey);
  if (shipmentIds.length === 0) return empty;

  const existing = await query(
    `SELECT shipment_id::text AS shipment_id, ${columns.map((c) => `${c}::text AS ${c}`).join(', ')}
     FROM shipment_ata_overrides
     WHERE shipment_id = ANY($1::uuid[])`,
    [shipmentIds],
  );
  const byShipment = new Map<string, Record<string, string | null>>();
  for (const row of existing.rows as Array<Record<string, string | null>>) {
    byShipment.set(String(row.shipment_id), row);
  }

  const changedShipmentIds: string[] = [];
  for (const shipmentId of shipmentIds) {
    const row = byShipment.get(shipmentId);
    const differs = columns.some((c) => (row?.[c] ?? null) !== (plan[c] ?? null));
    // No row and nothing to record: do not create an all-empty row just to say "JPS has not logged it yet".
    if (!row && columns.every((c) => plan[c] == null)) continue;
    if (!differs) continue;
    if (options.dryRun) {
      changedShipmentIds.push(shipmentId);
      continue;
    }

    const values = columns.map((c) => plan[c] ?? null);
    const placeholders = columns.map((_, i) => `$${i + 2}::date`);
    await query(
      `INSERT INTO shipment_ata_overrides (shipment_id, ${columns.join(', ')}, jps_synced_at, source)
       VALUES ($1::uuid, ${placeholders.join(', ')}, NOW(), 'jps')
       ON CONFLICT (shipment_id) DO UPDATE SET
         ${columns.map((c) => `${c} = EXCLUDED.${c}`).join(',\n         ')},
         jps_synced_at = NOW(),
         updated_at = CURRENT_TIMESTAMP`,
      [shipmentId, ...values],
    );
    changedShipmentIds.push(shipmentId);
  }

  if (changedShipmentIds.length > 0 && !options.dryRun) {
    // The same follow-up as a manual ATA: the lists, Shipping Performance and, through ATC, Trade Cycle and Log Cycle.
    invalidateAfterShipmentWrite(changedShipmentIds);
    logger.info('JPS actual times applied to shipments', {
      stoKey,
      shipments: changedShipmentIds.length,
      columns,
    });
  }
  return { shipmentIds, changedShipmentIds };
}
