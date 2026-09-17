import { Response } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import {
  InvalidDateInputError,
  escapeIlikePattern,
  parseOptionalStrictDateRange,
} from '../utils/strictDateInput';
import { resolveContractFilterParam } from '../utils/contractFilterParam';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePositiveInt(raw: unknown, fallback: number): number {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Read-only list of quality surveys.
 *
 * Quality data had no REST surface at all - it was reachable only through the pages that render
 * it - so any integration asking "what were the FFA / M&I readings for this contract" had nowhere
 * to go. Raised as ask 3 in the MCP connector correspondence of 24 August 2026, where nineteen
 * candidate paths under /api all returned 404 because none existed.
 *
 * Filters are pushed into the query rather than applied after the fetch, and `total` counts the
 * whole matching set, so a caller can tell a complete answer from a page of one. Contract
 * filtering accepts the same aliases as the shipment and trucking lists, via
 * {@link resolveContractFilterParam}, so one identifier works everywhere.
 */
export const getQualitySurveys = async (req: AuthRequest, res: Response) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const offset = (page - 1) * limit;

    const { dateFrom, dateTo } = parseOptionalStrictDateRange({
      dateFrom: (req.query as { dateFrom?: unknown }).dateFrom,
      dateTo: (req.query as { dateTo?: unknown }).dateTo,
    });

    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (sqlWithIndex: (i: number) => string, value: unknown): void => {
      params.push(value);
      conditions.push(sqlWithIndex(params.length));
    };

    const shipmentId = String((req.query as { shipmentId?: unknown }).shipmentId ?? '').trim();
    if (shipmentId) add((i) => `qs.shipment_id = $${i}::uuid`, shipmentId);

    // Accepts `contract`, `contractId` or `contract_id`; a uuid resolves to its contract number.
    const contract = await resolveContractFilterParam(req.query as Record<string, unknown>);
    if (contract) add((i) => `TRIM(COALESCE(c.contract_id::text, '')) = $${i}`, contract);

    const location = String((req.query as { location?: unknown }).location ?? '').trim();
    if (location) add((i) => `qs.location ILIKE $${i}`, escapeIlikePattern(location));

    const surveyor = String((req.query as { surveyor?: unknown }).surveyor ?? '').trim();
    if (surveyor) add((i) => `qs.surveyor ILIKE '%' || $${i} || '%'`, escapeIlikePattern(surveyor));

    const vessel = String((req.query as { vessel?: unknown }).vessel ?? '').trim();
    if (vessel) add((i) => `s.vessel_name ILIKE '%' || $${i} || '%'`, escapeIlikePattern(vessel));

    if (dateFrom) add((i) => `qs.survey_date >= $${i}::date`, dateFrom);
    if (dateTo) add((i) => `qs.survey_date <= $${i}::date`, dateTo);

    const fromSql = `
      FROM quality_surveys qs
      LEFT JOIN shipments s ON s.id = qs.shipment_id
      LEFT JOIN contracts c ON c.id = s.contract_id`;
    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Counted over the whole matching set, not the page, so a caller can trust `total`.
    const countResult = await query(`SELECT COUNT(*)::int AS total ${fromSql} ${whereSql}`, params);
    const total = Number(countResult.rows[0]?.total ?? 0);

    const rowsResult = await query(
      `SELECT
         qs.id,
         qs.shipment_id,
         s.shipment_id AS shipment_number,
         s.vessel_name,
         c.contract_id AS contract_number,
         c.po_number,
         qs.location,
         qs.survey_date,
         qs.surveyor,
         qs.coa_number,
         qs.status,
         qs.density,
         qs.ffa,
         qs.moisture,
         qs.impurity,
         qs.iv,
         qs.dobi,
         qs.color_red,
         qs.dirt_sand,
         qs.stone,
         qs.surveyor_charges,
         qs.remarks,
         qs.created_at,
         qs.updated_at
       ${fromSql}
       ${whereSql}
       ORDER BY qs.survey_date DESC NULLS LAST, qs.created_at DESC NULLS LAST, qs.id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return res.json({
      success: true,
      data: {
        surveys: rowsResult.rows,
        pagination: {
          total,
          page,
          limit,
          totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
        },
      },
    });
  } catch (error) {
    if (error instanceof InvalidDateInputError) {
      return res.status(400).json({ success: false, error: { message: error.message } });
    }
    logger.error('Get quality surveys error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch quality surveys' },
    });
  }
};
