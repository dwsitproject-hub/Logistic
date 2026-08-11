import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';
import {
  displayVesselCode,
  mapMasterVesselForApi,
} from '../utils/masterVesselCodeResolve';
import { uppercaseText, normalizeVesselName } from '../utils/vesselNameNormalize';
import { importMasterVesselJovinFromBuffer } from '../services/masterVesselJovinImport.service';
import { resolveMasterVessel } from '../services/resolveMasterVessel.service';
import {
  buildMasterVesselListWhere,
  buildMasterVesselOrderBy,
  MASTER_VESSEL_LAMBUNG_OPTIONS,
  MASTER_VESSEL_TERMS_OPTIONS,
  MASTER_VESSEL_TYPE_OPTIONS,
  parseMasterVesselListQuery,
} from '../utils/masterVesselListFilters';

/** Charter terms accept only V/C or T/C (case-insensitive); anything else stores NULL. */
const normalizeTerms = (value: unknown): string | null => {
  const s = String(value ?? '').trim().toUpperCase();
  return s === 'V/C' || s === 'T/C' ? s : null;
};

/** Coerce heating from boolean or "Yes"/"YES" string; anything else is false. */
const normalizeHeating = (value: unknown): boolean =>
  typeof value === 'boolean' ? value : value === 'Yes' || value === 'YES';

function pickVesselType(body: Record<string, unknown>): string | null {
  return uppercaseText(body.vessel_type ?? body.hull_type);
}

export const listMasterVessels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20 } = req.query as Record<string, unknown>;
    const offset = (Number(page) - 1) * Number(limit);
    const filters = parseMasterVesselListQuery(req.query as Record<string, unknown>);
    const { where, params } = buildMasterVesselListWhere(filters);
    const orderBy = buildMasterVesselOrderBy(filters.sortKey, filters.sortDir);

    const listSql = `
      SELECT id, vessel_code, vessel_name, vessel_capacity_mt, vessel_owner, vessel_owner_group,
             vessel_type, sap_vendor_code, code_status, year_of_creation, heating, lambung_type,
             terms, created_at, updated_at
      FROM master_vessels
      ${where}
      ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSql = `
      SELECT COUNT(*) AS count
      FROM master_vessels
      ${where}
    `;

    const [listResult, countResult] = await Promise.all([
      query(listSql, [...params, Number(limit), offset]),
      query(countSql, params),
    ]);

    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    res.json({
      success: true,
      data: {
        items: listResult.rows.map((row) => mapMasterVesselForApi(row)),
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.max(1, Math.ceil(total / Number(limit))),
        },
      },
    });
    return;
  } catch (error) {
    logger.error('List master vessels error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch master vessels' } });
    return;
  }
};

export const getMasterVesselFilterOptions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [ownersResult, vesselTypesResult, lambungResult, termsResult] = await Promise.all([
      query(`
        SELECT DISTINCT vessel_owner AS value
        FROM master_vessels
        WHERE vessel_owner IS NOT NULL AND trim(vessel_owner) <> ''
        ORDER BY vessel_owner ASC
      `),
      query(`
        SELECT DISTINCT vessel_type AS value
        FROM master_vessels
        WHERE vessel_type IS NOT NULL AND trim(vessel_type) <> ''
        ORDER BY vessel_type ASC
      `),
      query(`
        SELECT DISTINCT lambung_type AS value
        FROM master_vessels
        WHERE lambung_type IS NOT NULL AND trim(lambung_type) <> ''
        ORDER BY lambung_type ASC
      `),
      query(`
        SELECT DISTINCT terms AS value
        FROM master_vessels
        WHERE terms IS NOT NULL AND trim(terms) <> ''
        ORDER BY terms ASC
      `),
    ]);

    const mergeDistinct = (staticOptions: readonly string[], dbRows: { value: string }[]): string[] => {
      const set = new Set<string>(staticOptions);
      for (const row of dbRows) {
        const v = String(row.value ?? '').trim();
        if (v) set.add(v);
      }
      return [...set].sort((a, b) => a.localeCompare(b));
    };

    res.json({
      success: true,
      data: {
        owners: ownersResult.rows.map((r) => String(r.value).trim()),
        vesselTypes: mergeDistinct(MASTER_VESSEL_TYPE_OPTIONS, vesselTypesResult.rows),
        lambungTypes: mergeDistinct(MASTER_VESSEL_LAMBUNG_OPTIONS, lambungResult.rows),
        terms: mergeDistinct(MASTER_VESSEL_TERMS_OPTIONS, termsResult.rows),
      },
    });
    return;
  } catch (error) {
    logger.error('Get master vessel filter options error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch filter options' } });
    return;
  }
};

export const createMasterVessel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const vessel_code = uppercaseText(body.vessel_code);
    const vessel_name = uppercaseText(body.vessel_name);
    if (!vessel_code || !vessel_name) {
      res.status(400).json({
        success: false,
        error: { message: 'Vessel Code and Vessel Name are required' },
      });
      return;
    }

    const resolved = await resolveMasterVessel({
      vessel_code,
      vessel_name,
      vessel_owner: uppercaseText(body.vessel_owner),
      vessel_capacity_mt: body.vessel_capacity_mt != null ? Number(body.vessel_capacity_mt) : null,
      vessel_type: pickVesselType(body),
      sap_vendor_code: uppercaseText(body.sap_vendor_code),
      heating: normalizeHeating(body.heating),
      lambung_type: uppercaseText(body.lambung_type),
      terms: normalizeTerms(body.terms),
      source: 'manual',
      updateAttributes: true,
      code_status: 'OFFICIAL',
    });

    if (!resolved) {
      res.status(400).json({ success: false, error: { message: 'Failed to create master vessel' } });
      return;
    }

    const fetchResult = await query(`SELECT * FROM master_vessels WHERE id = $1`, [
      resolved.master_vessel_id,
    ]);

    res.status(resolved.created ? 201 : 200).json({
      success: true,
      data: mapMasterVesselForApi(fetchResult.rows[0]),
    });
    return;
  } catch (error: any) {
    logger.error('Create master vessel error:', error);
    if (error?.code === '23505') {
      res.status(400).json({ success: false, error: { message: 'Vessel code must be unique' } });
      return;
    }
    res.status(500).json({ success: false, error: { message: 'Failed to create master vessel' } });
    return;
  }
};

export const updateMasterVessel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;
    const vessel_code = body.vessel_code != null ? uppercaseText(body.vessel_code) : null;
    const vessel_name = body.vessel_name != null ? uppercaseText(body.vessel_name) : null;

    const updateSql = `
      UPDATE master_vessels
      SET
        vessel_code = COALESCE($1, vessel_code),
        vessel_name = COALESCE($2, vessel_name),
        normalized_vessel_name = COALESCE($3, normalized_vessel_name),
        vessel_capacity_mt = COALESCE($4, vessel_capacity_mt),
        vessel_owner = COALESCE($5, vessel_owner),
        vessel_owner_group = COALESCE($6, vessel_owner_group),
        vessel_type = COALESCE($7, vessel_type),
        sap_vendor_code = COALESCE($8, sap_vendor_code),
        year_of_creation = COALESCE($9, year_of_creation),
        heating = COALESCE($10, heating),
        lambung_type = COALESCE($11, lambung_type),
        terms = COALESCE($12, terms),
        code_status = CASE
          WHEN $1 IS NOT NULL AND upper(trim($1)) NOT LIKE 'TMP-%' THEN 'OFFICIAL'
          ELSE code_status
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $13
      RETURNING *
    `;

    const normName = vessel_name ? normalizeVesselName(vessel_name) : null;

    const result = await query(updateSql, [
      vessel_code,
      vessel_name,
      normName,
      body.vessel_capacity_mt ?? null,
      body.vessel_owner != null ? uppercaseText(body.vessel_owner) : null,
      body.vessel_owner_group != null ? uppercaseText(body.vessel_owner_group) : null,
      body.vessel_type != null || body.hull_type != null ? pickVesselType(body) : null,
      body.sap_vendor_code != null ? uppercaseText(body.sap_vendor_code) : null,
      body.year_of_creation ?? null,
      body.heating !== undefined ? normalizeHeating(body.heating) : null,
      body.lambung_type != null ? uppercaseText(body.lambung_type) : null,
      body.terms !== undefined ? normalizeTerms(body.terms) : null,
      id,
    ]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master vessel not found' } });
      return;
    }

    if (vessel_code) {
      await query(
        `INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary)
         VALUES ($1, upper(trim($2)), 'manual', true)
         ON CONFLICT (vessel_code) DO UPDATE SET
           master_vessel_id = EXCLUDED.master_vessel_id,
           is_primary = true,
           updated_at = CURRENT_TIMESTAMP`,
        [id, vessel_code],
      );
    }

    res.json({ success: true, data: mapMasterVesselForApi(result.rows[0]) });
    return;
  } catch (error: any) {
    logger.error('Update master vessel error:', error);
    if (error?.code === '23505') {
      res.status(400).json({ success: false, error: { message: 'Vessel code must be unique' } });
      return;
    }
    res.status(500).json({ success: false, error: { message: 'Failed to update master vessel' } });
    return;
  }
};

export const importJovinMasterVessels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ success: false, error: { message: 'Excel file is required' } });
      return;
    }

    const dryRun = String(req.query.dryRun ?? req.body?.dryRun ?? 'false').toLowerCase() === 'true';
    const stats = await importMasterVesselJovinFromBuffer(file.buffer, { dryRun });

    res.json({
      success: true,
      data: {
        ...stats,
        needsCodeReview: dryRun
          ? stats.needsCodeReview.slice(0, 20).map(({ vesselName }) => ({ vesselName }))
          : stats.needsCodeReview.map(({ vesselName }) => ({ vesselName })),
        pendingOfficialCount: stats.provisionalInserted,
      },
    });
    return;
  } catch (error: any) {
    logger.error('Import Jovin master vessels error:', error);
    res.status(500).json({
      success: false,
      error: { message: error?.message || 'Failed to import Jovin master vessels' },
    });
    return;
  }
};

export const deleteMasterVessel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM master_vessels WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master vessel not found' } });
      return;
    }
    res.json({ success: true, data: { id: result.rows[0].id } });
    return;
  } catch (error) {
    logger.error('Delete master vessel error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete master vessel' } });
    return;
  }
};

export { displayVesselCode, mapMasterVesselForApi };
