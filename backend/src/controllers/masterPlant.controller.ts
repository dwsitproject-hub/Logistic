import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';

export const listMasterPlants = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 50 } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    const params: any[] = [];
    let where = 'WHERE 1=1';
    if (search && typeof search === 'string' && search.trim().length > 0) {
      params.push(`%${search.trim()}%`);
      where += ` AND (
        company_name ILIKE $${params.length}
        OR plant_code ILIKE $${params.length}
        OR plant_name ILIKE $${params.length}
        OR city ILIKE $${params.length}
        OR plant_type ILIKE $${params.length}
        OR group_plant ILIKE $${params.length}
      )`;
    }

    const listSql = `
      SELECT
        id,
        company_name,
        plant_code,
        plant_name,
        postal_code,
        city,
        plant_type,
        group_plant,
        created_at,
        updated_at
      FROM master_plants
      ${where}
      ORDER BY company_name, plant_code
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSql = `
      SELECT COUNT(*) AS count
      FROM master_plants
      ${where}
    `;

    const [listResult, countResult] = await Promise.all([
      query(listSql, [...params, Number(limit), offset]),
      query(countSql, params),
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
  } catch (error) {
    logger.error('List master plants error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch master plants' } });
  }
};

export const createMasterPlant = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { company_name, plant_code, plant_name, postal_code, city, plant_type, group_plant } = req.body as any;

    const company = typeof company_name === 'string' ? company_name.trim() : String(company_name ?? '').trim();
    const code = typeof plant_code === 'string' ? plant_code.trim() : String(plant_code ?? '').trim();
    if (!company) {
      res.status(400).json({ success: false, error: { message: 'Company Name is required' } });
      return;
    }
    if (!code) {
      res.status(400).json({ success: false, error: { message: 'Plant Code is required' } });
      return;
    }

    const insertSql = `
      INSERT INTO master_plants (
        company_name, plant_code, plant_name, postal_code, city, plant_type, group_plant
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `;
    const result = await query(insertSql, [
      company,
      code,
      plant_name ?? null,
      postal_code ?? null,
      city ?? null,
      plant_type ?? null,
      group_plant ?? null,
    ]);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Create master plant error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create master plant' } });
  }
};

export const updateMasterPlant = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as any;
    const { company_name, plant_code, plant_name, postal_code, city, plant_type, group_plant } = req.body as any;

    const updateSql = `
      UPDATE master_plants
      SET
        company_name = COALESCE($1, company_name),
        plant_code = COALESCE($2, plant_code),
        plant_name = COALESCE($3, plant_name),
        postal_code = COALESCE($4, postal_code),
        city = COALESCE($5, city),
        plant_type = COALESCE($6, plant_type),
        group_plant = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *
    `;
    const result = await query(updateSql, [
      company_name ?? null,
      plant_code ?? null,
      plant_name ?? null,
      postal_code ?? null,
      city ?? null,
      plant_type ?? null,
      group_plant ?? null,
      id,
    ]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master plant not found' } });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Update master plant error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to update master plant' } });
  }
};

export const bulkUploadMasterPlants = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rows = req.body?.rows as Array<any>;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ success: false, error: { message: 'No rows provided' } });
      return;
    }

    let inserted = 0;
    let updated = 0;
    const errors: Array<{ row: number; plant_code: string; reason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const r = rows[i] ?? {};

      const company = typeof r.company_name === 'string' ? r.company_name.trim() : String(r.company_name ?? '').trim();
      const code = typeof r.plant_code === 'string' ? r.plant_code.trim() : String(r.plant_code ?? '').trim();
      const name = typeof r.plant_name === 'string' ? r.plant_name.trim() : (r.plant_name == null ? null : String(r.plant_name).trim());
      const postal = r.postal_code == null ? null : String(r.postal_code).trim();
      const city = typeof r.city === 'string' ? r.city.trim() : (r.city == null ? null : String(r.city).trim());
      const type = typeof r.plant_type === 'string' ? r.plant_type.trim() : (r.plant_type == null ? null : String(r.plant_type).trim());
      const groupPlant = typeof r.group_plant === 'string' ? r.group_plant.trim() : (r.group_plant == null ? null : String(r.group_plant).trim());

      if (!company) {
        errors.push({ row: rowNum, plant_code: code || '(empty)', reason: 'Missing company_name' });
        continue;
      }
      if (!code) {
        errors.push({ row: rowNum, plant_code: '(empty)', reason: 'Missing plant_code' });
        continue;
      }

      try {
        const existing = await query(
          'SELECT id FROM master_plants WHERE company_name = $1 AND plant_code = $2 LIMIT 1',
          [company, code]
        );

        if (existing.rows.length > 0) {
          // Only fill NULL fields — never overwrite data that already has a value.
          await query(
            `UPDATE master_plants SET
              plant_name  = COALESCE(plant_name,  $1),
              postal_code = COALESCE(postal_code, $2),
              city        = COALESCE(city,        $3),
              plant_type  = COALESCE(plant_type,  $4),
              group_plant = COALESCE(group_plant, $5),
              updated_at  = CURRENT_TIMESTAMP
             WHERE id = $6`,
            [name ?? null, postal ?? null, city ?? null, type ?? null, groupPlant ?? null, existing.rows[0].id]
          );
          updated += 1;
        } else {
          await query(
            `INSERT INTO master_plants (
              company_name, plant_code, plant_name, postal_code, city, plant_type, group_plant
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [company, code, name ?? null, postal ?? null, city ?? null, type ?? null, groupPlant ?? null]
          );
          inserted += 1;
        }
      } catch (err: any) {
        const reason = err?.message || err?.code || String(err);
        errors.push({ row: rowNum, plant_code: code, reason });
      }
    }

    const failed = errors.length;
    res.json({
      success: true,
      data: {
        total: rows.length,
        inserted,
        updated,
        success: inserted + updated,
        failed,
        errors,
      },
    });
  } catch (error) {
    logger.error('Bulk upload master plants error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to upload master plants' } });
  }
};

export const deleteMasterPlant = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as any;
    const result = await query('DELETE FROM master_plants WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master plant not found' } });
      return;
    }
    res.json({ success: true, data: { id: result.rows[0].id } });
  } catch (error) {
    logger.error('Delete master plant error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete master plant' } });
  }
};
