import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';

export const listMasterVessels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 50 } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    const params: any[] = [];
    let where = 'WHERE 1=1';

    if (search && typeof search === 'string' && search.trim().length > 0) {
      params.push(`%${search.trim()}%`);
      where += ` AND (vessel_code ILIKE $${params.length} OR vessel_name ILIKE $${params.length})`;
    }

    const listSql = `
      SELECT id, vessel_code, vessel_name, vessel_capacity_mt, vessel_owner, vessel_owner_group,
             hull_type, year_of_creation, heating, lambung_type, created_at, updated_at
      FROM master_vessels
      ${where}
      ORDER BY vessel_code
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSql = `
      SELECT COUNT(*) AS count
      FROM master_vessels
      ${where}
    `;

    const [listResult, countResult] = await Promise.all([
      query(listSql, [...params, Number(limit), offset]),
      query(countSql, params)
    ]);

    res.json({
      success: true,
      data: {
        items: listResult.rows,
        pagination: {
          total: parseInt(countResult.rows[0]?.count ?? '0', 10),
          page: Number(page),
          limit: Number(limit),
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

export const createMasterVessel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      vessel_code,
      vessel_name,
      vessel_capacity_mt,
      vessel_owner,
      vessel_owner_group,
      hull_type,
      year_of_creation,
      heating,
      lambung_type,
    } = req.body;

    const insertSql = `
      INSERT INTO master_vessels (
        vessel_code, vessel_name, vessel_capacity_mt, vessel_owner, vessel_owner_group,
        hull_type, year_of_creation, heating, lambung_type
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `;
    const result = await query(insertSql, [
      vessel_code,
      vessel_name,
      vessel_capacity_mt ?? null,
      vessel_owner ?? null,
      vessel_owner_group ?? null,
      hull_type ?? null,
      year_of_creation ?? null,
      typeof heating === 'boolean' ? heating : heating === 'Yes' || heating === 'YES',
      lambung_type ?? null,
    ]);

    res.status(201).json({ success: true, data: result.rows[0] });
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
    const {
      vessel_code,
      vessel_name,
      vessel_capacity_mt,
      vessel_owner,
      vessel_owner_group,
      hull_type,
      year_of_creation,
      heating,
      lambung_type,
    } = req.body;

    const updateSql = `
      UPDATE master_vessels
      SET
        vessel_code = COALESCE($1, vessel_code),
        vessel_name = COALESCE($2, vessel_name),
        vessel_capacity_mt = COALESCE($3, vessel_capacity_mt),
        vessel_owner = COALESCE($4, vessel_owner),
        vessel_owner_group = COALESCE($5, vessel_owner_group),
        hull_type = COALESCE($6, hull_type),
        year_of_creation = COALESCE($7, year_of_creation),
        heating = COALESCE($8, heating),
        lambung_type = COALESCE($9, lambung_type),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `;

    const result = await query(updateSql, [
      vessel_code ?? null,
      vessel_name ?? null,
      vessel_capacity_mt ?? null,
      vessel_owner ?? null,
      vessel_owner_group ?? null,
      hull_type ?? null,
      year_of_creation ?? null,
      typeof heating === 'boolean' ? heating : heating === 'Yes' || heating === 'YES',
      lambung_type ?? null,
      id,
    ]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master vessel not found' } });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
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

export const bulkUploadMasterVessels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rows = req.body?.rows as Array<any>;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ success: false, error: { message: 'No rows provided' } });
      return;
    }

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const {
        vessel_code,
        vessel_name,
        vessel_capacity_mt,
        vessel_owner,
        vessel_owner_group,
        hull_type,
        year_of_creation,
        heating,
        lambung_type,
      } = row;

      if (!vessel_code || !vessel_name) {
        continue;
      }

      const upsertSql = `
        INSERT INTO master_vessels (
          vessel_code, vessel_name, vessel_capacity_mt, vessel_owner, vessel_owner_group,
          hull_type, year_of_creation, heating, lambung_type
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (vessel_code) DO UPDATE SET
          vessel_name = EXCLUDED.vessel_name,
          vessel_capacity_mt = EXCLUDED.vessel_capacity_mt,
          vessel_owner = EXCLUDED.vessel_owner,
          vessel_owner_group = EXCLUDED.vessel_owner_group,
          hull_type = EXCLUDED.hull_type,
          year_of_creation = EXCLUDED.year_of_creation,
          heating = EXCLUDED.heating,
          lambung_type = EXCLUDED.lambung_type,
          updated_at = CURRENT_TIMESTAMP
        RETURNING xmax = 0 AS inserted
      `;

      const result = await query(upsertSql, [
        vessel_code,
        vessel_name,
        vessel_capacity_mt ?? null,
        vessel_owner ?? null,
        vessel_owner_group ?? null,
        hull_type ?? null,
        year_of_creation ?? null,
        typeof heating === 'boolean' ? heating : heating === 'Yes' || heating === 'YES',
        lambung_type ?? null,
      ]);

      if (result.rows[0]?.inserted) inserted += 1;
      else updated += 1;
    }

    res.json({
      success: true,
      data: {
        inserted,
        updated,
        total: rows.length,
      },
    });
    return;
  } catch (error) {
    logger.error('Bulk upload master vessels error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to upload master vessels' } });
    return;
  }
};

