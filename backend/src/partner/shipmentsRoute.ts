import type { Request, Response } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { PARTNER_MAX_PAGE } from './catalog';
import { noteForCallLog, sendPartnerError } from './http';
import { PartnerQueryError, encodeCursor, parseShipmentsQuery, type ParsedShipmentsQuery } from './query';
import { refreshPartnerRecords } from './refresh';
import { PARTNER_PAIRS_SQL } from './recordSql';
import type { PairRow } from './recordBuilder';

/** How long a record that left the active set (or was deleted) keeps showing up in incremental reads, so KMAPS can retire it (contract 4.2). */
const RETIRE_WINDOW_DAYS = 14;

interface RecordRow {
  record_id: string;
  version: string;
  updated_iso: string;
  updated_raw: string;
  deleted: boolean;
  active: boolean;
  payload: Record<string, unknown> | null;
}

const COLUMNS = `
  r.record_id,
  r.version::text AS version,
  to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_iso,
  r.updated_at::text AS updated_raw,
  r.deleted,
  r.active,
  r.payload`;

/** The record as KMAPS reads it (contract 5.2), or the short tombstone (5.3). */
export function toPartnerRecord(row: RecordRow): Record<string, unknown> {
  const version = Number(row.version);
  if (row.deleted || !row.payload) {
    return { id: row.record_id, deleted: true, active: false, version, updatedAt: row.updated_iso };
  }
  const { shipmentNo, stoNumber, ...rest } = row.payload;
  return {
    id: row.record_id,
    shipmentNo,
    stoNumber,
    version,
    updatedAt: row.updated_iso,
    deleted: false,
    active: row.active,
    ...rest,
  };
}

/** Never served before the first build finished: an empty answer would read as "no shipment is active" and KMAPS would retire everything it holds. */
async function recordsReady(res: Response): Promise<boolean> {
  const state = await query(`SELECT refreshed_at FROM partner_snapshot_state WHERE id = 1`);
  if (state.rows[0]?.refreshed_at) return true;
  void refreshPartnerRecords().catch(() => undefined);
  sendPartnerError(res, 503, 'server_error', 'The records are being prepared; try again in a minute', { 'Retry-After': '30' });
  return false;
}

export function buildListSql(q: ParsedShipmentsQuery): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const days = RETIRE_WINDOW_DAYS;
  const where: string[] = [];

  // `retired` records are those that left the active set within the window; only the incremental readings show them.
  const showsRetired = q.mode === 'incremental' || (q.mode === 'vessel' && q.updatedSince !== null);
  const live = showsRetired
    ? `(NOT r.deleted AND (r.active OR r.left_active_at > NOW() - INTERVAL '${days} days'))`
    : `(NOT r.deleted AND r.active)`;
  const tomb = q.includeDeleted && q.mode !== 'full' ? ` OR (r.deleted AND r.deleted_at > NOW() - INTERVAL '${days} days')` : '';
  where.push(`(${live}${tomb})`);

  if (q.mode === 'vessel') {
    const codes = add(q.vesselCodes);
    const sap = add(q.sapCodes);
    where.push(`(r.vessel_dhm_code = ANY(${codes}::text[]) OR r.vessel_sap_codes && ${sap}::text[])`);
  }
  if (q.updatedSince) where.push(`r.updated_at > ${add(q.updatedSince)}::timestamptz`);
  if (q.after) where.push(`(r.updated_at, r.record_id) > (${add(q.after.updatedAt)}::timestamptz, ${add(q.after.recordId)})`);

  const limit = add(q.limit + 1);
  return {
    text: `SELECT ${COLUMNS} FROM partner_shipment_records r WHERE ${where.join(' AND ')} ORDER BY r.updated_at, r.record_id LIMIT ${limit}`,
    params,
  };
}

export async function listShipments(req: Request, res: Response): Promise<void> {
  let parsed: ParsedShipmentsQuery;
  try {
    parsed = parseShipmentsQuery(req.query as Record<string, unknown>);
  } catch (error) {
    if (error instanceof PartnerQueryError) {
      sendPartnerError(res, 400, 'validation_error', error.message);
      return;
    }
    throw error;
  }
  if (!(await recordsReady(res))) return;

  const { text, params } = buildListSql(parsed);
  const result = await query(text, params);
  const rows = result.rows as RecordRow[];
  const hasMore = rows.length > parsed.limit;
  const page = hasMore ? rows.slice(0, parsed.limit) : rows;
  const last = page[page.length - 1];
  const serverTime = (await query(`SELECT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t`)).rows[0].t as string;

  noteForCallLog(res, {
    subject: parsed.mode === 'vessel' ? `${parsed.vesselCodes.length} vessel / ${parsed.sapCodes.length} SAP codes` : parsed.mode,
    records: page.length,
  });

  res.json({
    records: page.map(toPartnerRecord),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(parsed.mode, last.updated_raw, last.record_id) : null,
    serverTime,
  });
}

export async function getShipment(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id ?? '');
  if (!/^shp_[a-z0-9]{10}$/.test(id)) {
    sendPartnerError(res, 404, 'not_found', 'Unknown record');
    return;
  }
  if (!(await recordsReady(res))) return;
  const includeDeleted = String(req.query.includeDeleted ?? '') === 'true';
  const result = await query(
    `SELECT ${COLUMNS} FROM partner_shipment_records r
      WHERE r.record_id = $1
        AND ( (NOT r.deleted AND (r.active OR r.left_active_at > NOW() - INTERVAL '${RETIRE_WINDOW_DAYS} days'))
              OR ($2::boolean AND r.deleted AND r.deleted_at > NOW() - INTERVAL '${RETIRE_WINDOW_DAYS} days') )`,
    [id, includeDeleted],
  );
  const row = (result.rows as RecordRow[])[0];
  if (!row) {
    sendPartnerError(res, 404, 'not_found', 'Unknown record or outside the scope');
    return;
  }
  noteForCallLog(res, { subject: id, records: 1 });
  res.json(toPartnerRecord(row));
}

/**
 * GET /vessel-pairs (contract 4.3): the whole list, every pair with both DHM codes. A pair KLIP cannot name by DHM codes yet (a vessel not linked to DHM, or the
 * same code on both sides) is left out rather than sent with a hole: KMAPS would reject it and list it as an error. No version, no tombstone.
 */
export async function listVesselPairs(req: Request, res: Response): Promise<void> {
  try {
    const limitRaw = req.query.limit === undefined ? PARTNER_MAX_PAGE : Number(req.query.limit);
    if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > PARTNER_MAX_PAGE) {
      sendPartnerError(res, 400, 'validation_error', `limit must be a whole number from 1 to ${PARTNER_MAX_PAGE}`);
      return;
    }
    let after: string | null = null;
    if (typeof req.query.cursor === 'string' && req.query.cursor !== '') {
      try {
        after = String(JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString('utf8')).p ?? '') || null;
      } catch {
        after = null;
      }
      if (!after) {
        sendPartnerError(res, 400, 'validation_error', 'cursor is not valid');
        return;
      }
    }
    const rows = (await query(PARTNER_PAIRS_SQL)).rows as PairRow[];
    const usable = rows
      .filter((p) => p.bg_code && p.tb_code && p.bg_code !== p.tb_code)
      .filter((p) => after === null || p.pair_code > after);
    const page = usable.slice(0, limitRaw);
    const hasMore = usable.length > limitRaw;
    const serverTime = (await query(`SELECT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t`)).rows[0].t as string;
    noteForCallLog(res, { subject: 'vessel pairs', records: page.length });
    res.json({
      records: page.map((p) => ({
        pairCode: p.pair_code,
        active: true,
        barge: { dhmCode: p.bg_code, name: p.bg_name },
        tug: { dhmCode: p.tb_code, name: p.tb_name },
        lastContractDate: p.last_contract_date,
      })),
      hasMore,
      nextCursor: hasMore ? Buffer.from(JSON.stringify({ p: page[page.length - 1].pair_code }), 'utf8').toString('base64url') : null,
      serverTime,
    });
  } catch (error) {
    logger.error('Partner vessel-pairs error', { error: error instanceof Error ? error.message : String(error) });
    sendPartnerError(res, 500, 'server_error', 'Internal error');
  }
}
