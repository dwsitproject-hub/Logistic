import { Response } from 'express';
import { attachDhmPushState, pushMasterSiteToDhm } from '../dhm';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { masterDhmCountsSelect, masterDhmFilterClause, parseMasterDhmFilter } from '../utils/masterDhmFilter';

const SITE_DHM = { table: 'master_sites', kind: 'site' } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const { search, page = 1, limit = 50, dhm, company } = req.query as {
      search?: string;
      page?: string;
      limit?: string;
      dhm?: string;
      company?: string;
    };
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
    // DHM status (All / Synced / Not synced / Failed) and the company a Site belongs to: judged here, not on the 20 rows on screen, because the list is paged.
    const dhmClause = masterDhmFilterClause(parseMasterDhmFilter(dhm), SITE_DHM);
    if (dhmClause) where += ` AND ${dhmClause}`;
    if (company && UUID_RE.test(company.trim())) {
      params.push(company.trim());
      where += ` AND EXISTS (SELECT 1 FROM master_company_sites company_filter WHERE company_filter.site_id = master_sites.id AND company_filter.company_id = $${params.length}::uuid)`;
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
                -- the same companies as a list, so a name that holds a comma is not cut in two by the page (it shows them one per row in a dialog)
                COALESCE(
                  NULLIF(ARRAY(SELECT c.company_name::text
                                 FROM master_company_sites l
                                 JOIN master_companies c ON c.id = l.company_id
                                WHERE l.site_id = master_sites.id
                                ORDER BY c.company_name), '{}'::text[]),
                  CASE WHEN COALESCE(company_name, '') = '' THEN '{}'::text[] ELSE ARRAY[company_name::text] END
                ) AS company_names,
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

/**
 * The cards above the Master Site list (GET /master-sites/summary): how many Sites there are, how many DHM has, how many it does not, how many failed to
 * deliver, and how many KLIP actually uses (a Site linked to a plant or to a port, which is where the Region/Site filters of the pages come from).
 * Also the companies that have Sites, for the Company filter. Counts are over ALL Sites, not the page or the filters on screen.
 */
export const getMasterSiteSummary = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [counts, companies] = await Promise.all([
      query(
        `SELECT ${masterDhmCountsSelect(SITE_DHM)},
                COUNT(*) FILTER (
                  WHERE EXISTS (SELECT 1 FROM master_plants p WHERE p.site_id = master_sites.id)
                     OR EXISTS (SELECT 1 FROM master_loading_ports lp WHERE lp.site_id = master_sites.id)
                )::int AS used_in_klip
         FROM master_sites`,
      ),
      query(
        `SELECT c.id::text AS id, c.company_name, COUNT(*)::int AS sites
         FROM master_companies c
         JOIN master_company_sites l ON l.company_id = c.id
         GROUP BY c.id, c.company_name
         ORDER BY c.company_name`,
      ),
    ]);
    const row = counts.rows[0] ?? {};
    res.json({
      success: true,
      data: {
        total: Number(row.total ?? 0),
        synced: Number(row.synced ?? 0),
        notSynced: Number(row.not_synced ?? 0),
        failed: Number(row.failed ?? 0),
        usedInKlip: Number(row.used_in_klip ?? 0),
        companies: companies.rows.map((c: { id: string; company_name: string; sites: number }) => ({
          id: c.id,
          name: c.company_name,
          sites: Number(c.sites),
        })),
      },
    });
  } catch (error) {
    logger.error('Master site summary error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to load the Master Site summary' } });
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
