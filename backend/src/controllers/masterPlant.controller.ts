import { Response } from 'express';
import { pushMasterPlantToDhm } from '../dhm';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';

function wantsDhmOverwrite(req: AuthRequest): boolean {
  const q = String((req.query as { dhmOverwrite?: unknown }).dhmOverwrite ?? '').toLowerCase();
  return q === 'true' || q === '1';
}

export const listMasterPlants = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 50 } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    const params: any[] = [];
    let where = 'WHERE 1=1';
    if (search && typeof search === 'string' && search.trim().length > 0) {
      params.push(`%${search.trim()}%`);
      where += ` AND (
        master_plants.company_name ILIKE $${params.length}
        OR master_plants.plant_code ILIKE $${params.length}
        OR master_plants.plant_name ILIKE $${params.length}
        OR master_plants.city ILIKE $${params.length}
        OR master_plants.plant_type ILIKE $${params.length}
        OR master_plants.group_plant ILIKE $${params.length}
        OR master_plants.company_code ILIKE $${params.length}
        OR master_plants.site ILIKE $${params.length}
        OR linked_site.site_name ILIKE $${params.length}
        OR master_plants.found_in ILIKE $${params.length}
        OR master_plants.code_klip ILIKE $${params.length}
        OR master_plants.code_dhm ILIKE $${params.length}
      )`;
    }

    const listSql = `
      SELECT
        master_plants.id,
        master_plants.company_code,
        master_plants.company_name,
        master_plants.plant_code,
        master_plants.plant_name,
        master_plants.plant_type,
        COALESCE(linked_site.site_name, master_plants.site) AS site,
        master_plants.site_id,
        master_plants.city,
        master_plants.postal_code,
        master_plants.found_in,
        master_plants.code_klip,
        master_plants.code_dhm,
        master_plants.dhm_org_code,
        master_plants.dhm_id,
        master_plants.group_plant,
        master_plants.created_at,
        master_plants.updated_at
      FROM master_plants
      LEFT JOIN master_sites AS linked_site ON linked_site.id = master_plants.site_id
      ${where}
      ORDER BY company_name, plant_code
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    // The search clause above reads linked_site.site_name, so the count needs the same join. Without
    // it every search with text was "missing FROM-clause entry for table linked_site" (HTTP 500),
    // which is what the Edit Shipment modal hit looking a plant up by code. One row per plant on
    // both sides, so the join cannot change the count.
    const countSql = `
      SELECT COUNT(*) AS count
      FROM master_plants
      LEFT JOIN master_sites AS linked_site ON linked_site.id = master_plants.site_id
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
    const { company_code, company_name, plant_code, plant_name, postal_code, city, plant_type, site, site_id, found_in, group_plant } = req.body as any;

    const company = typeof company_name === 'string' ? company_name.trim() : String(company_name ?? '').trim();
    const code = typeof plant_code === 'string' ? plant_code.trim() : String(plant_code ?? '').trim();
    const plantLabel = typeof plant_name === 'string' ? plant_name.trim() : String(plant_name ?? '').trim();
    if (!code) {
      res.status(400).json({ success: false, error: { message: 'Plant Code is required' } });
      return;
    }

    const insertSql = `
      INSERT INTO master_plants (
        company_code, company_name, plant_code, plant_name, postal_code, city, plant_type, site, site_id, found_in, group_plant
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        COALESCE((SELECT site_name FROM master_sites WHERE id = $9::uuid), $8),
        $9::uuid,$10,$11
      )
      RETURNING *
    `;
    const result = await query(insertSql, [
      company_code ?? null,
      company || plantLabel || code,
      code,
      plant_name ?? null,
      postal_code ?? null,
      city ?? null,
      plant_type ?? null,
      site ?? null,
      site_id || null,
      found_in ?? null,
      group_plant ?? null,
    ]);
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushMasterPlantToDhm(String(saved.id), saved, { overwrite: wantsDhmOverwrite(req) });
    const refreshed = await query(`SELECT * FROM master_plants WHERE id = $1`, [saved.id]);

    res.status(201).json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
  } catch (error) {
    logger.error('Create master plant error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to create master plant' } });
  }
};

export const updateMasterPlant = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as any;
    const { company_code, company_name, plant_code, plant_name, postal_code, city, plant_type, site, site_id, found_in, group_plant } = req.body as any;

    const updateSql = `
      UPDATE master_plants
      SET
        company_code = $1,
        company_name = COALESCE(NULLIF($2, ''), company_name),
        plant_code = COALESCE($3, plant_code),
        plant_name = $4,
        postal_code = $5,
        city = $6,
        plant_type = $7,
        site_id = $9::uuid,
        site = COALESCE((SELECT site_name FROM master_sites WHERE id = $9::uuid), $8),
        found_in = $10,
        group_plant = COALESCE($11, group_plant),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING *
    `;
    const result = await query(updateSql, [
      company_code ?? null,
      company_name ?? null,
      plant_code ?? null,
      plant_name ?? null,
      postal_code ?? null,
      city ?? null,
      plant_type ?? null,
      site ?? null,
      site_id || null,
      found_in ?? null,
      group_plant ?? null,
      id,
    ]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master plant not found' } });
      return;
    }
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushMasterPlantToDhm(String(saved.id), saved, { overwrite: wantsDhmOverwrite(req) });
    const refreshed = await query(`SELECT * FROM master_plants WHERE id = $1`, [id]);

    res.json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
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
