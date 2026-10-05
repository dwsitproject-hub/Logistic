import { Response } from 'express';
import { attachDhmPushState, pushMasterCompanyToDhm } from '../dhm';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function siteIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

function wantsDhmOverwrite(req: AuthRequest): boolean {
  const q = String((req.query as { dhmOverwrite?: unknown }).dhmOverwrite ?? '').toLowerCase();
  return q === 'true' || q === '1';
}

async function replaceCompanySites(companyId: string, ids: string[]): Promise<void> {
  await query(`DELETE FROM master_company_sites WHERE company_id = $1::uuid`, [companyId]);
  if (!ids.length) return;
  await query(
    `INSERT INTO master_company_sites (company_id, site_id)
     SELECT $1::uuid, site.id
     FROM master_sites site
     WHERE site.id = ANY($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [companyId, ids],
  );
}

const listSelect = `
  SELECT company.id, company.code_klip, company.code_dhm, company.company_code, company.company_name, company.dhm_id,
         COALESCE(array_agg(site.id::text ORDER BY site.site_name) FILTER (WHERE site.id IS NOT NULL), '{}') AS site_ids,
         COALESCE(string_agg(site.site_name, ', ' ORDER BY site.site_name), '') AS site
  FROM master_companies company
  LEFT JOIN master_company_sites link ON link.company_id = company.id
  LEFT JOIN master_sites site ON site.id = link.site_id
`;

export const listMasterCompanies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 50 } = req.query as { search?: string; page?: string; limit?: string };
    const offset = (Number(page) - 1) * Number(limit);
    const params: unknown[] = [];
    let where = 'WHERE 1=1';
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      where += ` AND (
        company.company_code ILIKE $${params.length}
        OR company.company_name ILIKE $${params.length}
        OR company.code_klip ILIKE $${params.length}
        OR company.code_dhm ILIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM master_company_sites matched
          JOIN master_sites matched_site ON matched_site.id = matched.site_id
          WHERE matched.company_id = company.id
            AND matched_site.site_name ILIKE $${params.length}
        )
      )`;
    }
    const [listResult, countResult] = await Promise.all([
      query(
        `${listSelect}
         ${where}
         GROUP BY company.id
         ORDER BY company.company_name
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, Number(limit), offset],
      ),
      query(`SELECT COUNT(*) AS count FROM master_companies company ${where}`, params),
    ]);
    res.json({
      success: true,
      data: {
        items: await attachDhmPushState('company', listResult.rows),
        pagination: {
          total: parseInt(countResult.rows[0]?.count ?? '0', 10),
          page: Number(page),
          limit: Number(limit),
        },
      },
    });
  } catch (error) {
    logger.error('List master companies error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to fetch master companies' } });
  }
};

export const createMasterCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const companyCode = textOrNull(req.body?.company_code);
    const companyName = textOrNull(req.body?.company_name);
    if (!companyCode || !companyName) {
      res.status(400).json({ success: false, error: { message: 'Company Code (SAP) and Company Name are required' } });
      return;
    }
    const result = await query(
      `INSERT INTO master_companies (company_code, company_name) VALUES ($1, $2) RETURNING id`,
      [companyCode, companyName],
    );
    const id = String(result.rows[0].id);
    await replaceCompanySites(id, siteIds(req.body?.site_ids));
    const saved = await query(`${listSelect} WHERE company.id = $1::uuid GROUP BY company.id`, [id]);
    const row = saved.rows[0] as Record<string, unknown>;
    const dhm = await pushMasterCompanyToDhm(id, row, { overwrite: wantsDhmOverwrite(req) });
    const refreshed = await query(`${listSelect} WHERE company.id = $1::uuid GROUP BY company.id`, [id]);
    res.status(201).json({ success: true, data: { ...(refreshed.rows[0] ?? row), ...dhm } });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    logger.error('Create master company error:', error);
    res.status(code === '23505' ? 400 : 500).json({
      success: false,
      error: { message: code === '23505' ? 'This company code already exists' : 'Failed to create master company' },
    });
  }
};

export const updateMasterCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const companyCode = textOrNull(req.body?.company_code);
    const companyName = textOrNull(req.body?.company_name);
    if (!companyCode || !companyName) {
      res.status(400).json({ success: false, error: { message: 'Company Code (SAP) and Company Name are required' } });
      return;
    }
    const updated = await query(
      `UPDATE master_companies
       SET company_code = $2, company_name = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid
       RETURNING id`,
      [req.params.id, companyCode, companyName],
    );
    if (!updated.rows[0]) {
      res.status(404).json({ success: false, error: { message: 'Master company not found' } });
      return;
    }
    const id = String(updated.rows[0].id);
    await replaceCompanySites(id, siteIds(req.body?.site_ids));
    const saved = await query(`${listSelect} WHERE company.id = $1::uuid GROUP BY company.id`, [id]);
    const row = saved.rows[0] as Record<string, unknown>;
    const dhm = await pushMasterCompanyToDhm(id, row, { overwrite: wantsDhmOverwrite(req) });
    const refreshed = await query(`${listSelect} WHERE company.id = $1::uuid GROUP BY company.id`, [id]);
    res.json({ success: true, data: { ...(refreshed.rows[0] ?? row), ...dhm } });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    logger.error('Update master company error:', error);
    res.status(code === '23505' ? 400 : 500).json({
      success: false,
      error: { message: code === '23505' ? 'This company code already exists' : 'Failed to update master company' },
    });
  }
};

export const deleteMasterCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await query(`DELETE FROM master_companies WHERE id = $1::uuid RETURNING id`, [req.params.id]);
    if (!result.rows[0]) {
      res.status(404).json({ success: false, error: { message: 'Master company not found' } });
      return;
    }
    res.json({ success: true, data: { id: req.params.id } });
  } catch (error) {
    logger.error('Delete master company error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete master company' } });
  }
};
