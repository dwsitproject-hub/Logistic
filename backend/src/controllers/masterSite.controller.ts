import { Response } from 'express';
import { attachDhmPushState, pushMasterSiteToDhm } from '../dhm';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function wantsDhmOverwrite(req: AuthRequest): boolean {
  const q = String((req.query as { dhmOverwrite?: unknown }).dhmOverwrite ?? '').toLowerCase();
  return q === 'true' || q === '1';
}

export const listMasterSites = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 50 } = req.query as { search?: string; page?: string; limit?: string };
    const offset = (Number(page) - 1) * Number(limit);
    const params: unknown[] = [];
    let where = 'WHERE 1=1';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where += ` AND (
        site_name ILIKE $${params.length}
        OR company_name ILIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM master_company_sites search_link
          JOIN master_companies search_company ON search_company.id = search_link.company_id
          WHERE search_link.site_id = master_sites.id
            AND search_company.company_name ILIKE $${params.length}
        )
        OR city ILIKE $${params.length}
        OR postal_code ILIKE $${params.length}
        OR code_klip ILIKE $${params.length}
        OR code_dhm ILIKE $${params.length}
      )`;
    }
    const [listResult, countResult] = await Promise.all([
      query(
        // company_name is the companies linked to the Site (master_company_sites), all of them, because a Site can
        // belong to several. The stored text is only the fallback for a Site with no link: after the masters were
        // replaced from the sheet it was filled on 7 Sites and empty on the rest, while the links were complete.
        `SELECT id, code_klip, code_dhm, site_name,
                COALESCE(
                  NULLIF((SELECT string_agg(c.company_name, ', ' ORDER BY c.company_name)
                            FROM master_company_sites l
                            JOIN master_companies c ON c.id = l.company_id
                           WHERE l.site_id = master_sites.id), ''),
                  company_name
                ) AS company_name,
                city, postal_code, dhm_id, created_at, updated_at
         FROM master_sites ${where}
         ORDER BY site_name
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, Number(limit), offset],
      ),
      query(`SELECT COUNT(*) AS count FROM master_sites ${where}`, params),
    ]);
    res.json({
      success: true,
      data: {
        items: await attachDhmPushState('site', listResult.rows),
        pagination: {
          total: parseInt(countResult.rows[0]?.count ?? '0', 10),
          page: Number(page),
          limit: Number(limit),
        },
      },
    });
  } catch (error) {
    logger.error('List master sites error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch master sites' } });
  }
};

export const createMasterSite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const siteName = textOrNull(req.body?.site_name);
    if (!siteName) {
      res.status(400).json({ success: false, error: { message: 'Site is required' } });
      return;
    }
    const result = await query(
      `INSERT INTO master_sites (site_name, city, postal_code) VALUES ($1, $2, $3) RETURNING *`,
      [siteName, textOrNull(req.body?.city), textOrNull(req.body?.postal_code)],
    );
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushMasterSiteToDhm(String(saved.id), saved, { overwrite: wantsDhmOverwrite(req) });
    const refreshed = await query(`SELECT * FROM master_sites WHERE id = $1`, [saved.id]);
    res.status(201).json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    logger.error('Create master site error:', error);
    res.status(code === '23505' ? 400 : 500).json({
      success: false,
      error: { message: code === '23505' ? 'This site already exists' : 'Failed to create master site' },
    });
  }
};

export const updateMasterSite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const siteName = textOrNull(req.body?.site_name);
    if (!siteName) {
      res.status(400).json({ success: false, error: { message: 'Site is required' } });
      return;
    }
    const result = await query(
      `UPDATE master_sites
       SET site_name = $2, city = $3, postal_code = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [req.params.id, siteName, textOrNull(req.body?.city), textOrNull(req.body?.postal_code)],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master site not found' } });
      return;
    }
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushMasterSiteToDhm(String(saved.id), saved, { overwrite: wantsDhmOverwrite(req) });
    const refreshed = await query(`SELECT * FROM master_sites WHERE id = $1`, [req.params.id]);
    res.json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    logger.error('Update master site error:', error);
    res.status(code === '23505' ? 400 : 500).json({
      success: false,
      error: { message: code === '23505' ? 'This site already exists' : 'Failed to update master site' },
    });
  }
};

export const deleteMasterSite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await query(`DELETE FROM master_sites WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master site not found' } });
      return;
    }
    res.json({ success: true, data: { id: result.rows[0].id } });
  } catch (error) {
    logger.error('Delete master site error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete master site' } });
  }
};
