import { Request, Response } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';

interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

const TABLE = 'supplier_groups';

// List all groups with aggregated supplier data
export const listSupplierGroups = async (req: AuthRequest, res: Response) => {
  try {
    const { search = '', page = '1', limit = '50' } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const offset = (pageNum - 1) * limitNum;

    const whereClause = search
      ? `WHERE s.group_id ILIKE $1 OR s.mills ILIKE $1 OR s.parent_company ILIKE $1 OR s.province ILIKE $1`
      : '';
    const params: any[] = search ? [`%${search}%`] : [];

    const sql = `
      SELECT
        s.group_id,
        MAX(s.parent_company)        AS parent_company,
        MAX(s.group_type)            AS group_type,
        MAX(s.group_scale)           AS group_scale,
        MAX(s.integrated_status)     AS integrated_status,
        (
          SELECT COUNT(*)::int
          FROM contracts c
          WHERE c.group_name = s.group_id
            AND c.status NOT IN ('Cancelled', 'CANCELLED')
        )                            AS jumlah_pks,
        ROUND(SUM(COALESCE(s.cap::numeric, 0))::numeric, 2)              AS total_cap,
        ROUND(SUM(COALESCE(s.cpo_prod_est_month, 0))::numeric, 2)       AS cpo_month,
        ROUND(SUM(COALESCE(s.pk_prod_est_month, 0))::numeric, 2)        AS pk_month,
        ROUND(SUM(COALESCE(s.pome_prod_est_month, 0))::numeric, 2)      AS pome_month,
        ROUND(SUM(COALESCE(s.shell_prod_est_month, 0))::numeric, 2)     AS shell_month,
        ROUND(SUM(COALESCE(s.cpo_prod_est_year, 0))::numeric, 2)        AS cpo_year,
        ROUND(SUM(COALESCE(s.pk_prod_est_year, 0))::numeric, 2)         AS pk_year,
        ROUND(SUM(COALESCE(s.pome_prod_est_year, 0))::numeric, 2)       AS pome_year,
        ROUND(SUM(COALESCE(s.shell_prod_est_year, 0))::numeric, 2)      AS shell_year,
        STRING_AGG(DISTINCT s.province, ', ' ORDER BY s.province)       AS provinces,
        STRING_AGG(DISTINCT s.island, ', ' ORDER BY s.island)           AS islands,
        -- first mill's coordinates
        (ARRAY_AGG(s.latitude  ORDER BY s.mill_code))[1]                AS latitude,
        (ARRAY_AGG(s.longitude ORDER BY s.mill_code))[1]                AS longitude,
        -- loading method derived from contracts transport_mode
        (
          SELECT STRING_AGG(DISTINCT c.transport_mode, ' / ' ORDER BY c.transport_mode)
          FROM contracts c
          WHERE c.group_name = s.group_id
            AND c.transport_mode IS NOT NULL
            AND c.status NOT IN ('Cancelled', 'CANCELLED')
        )                            AS loading_method,
        -- fleet metrics derived from shipments via contracts
        (
          SELECT COUNT(sh.id)::int
          FROM shipments sh
          JOIN contracts c ON c.id = sh.contract_id
          WHERE c.group_name = s.group_id
            AND sh.status NOT IN ('CANCELLED')
        )                            AS total_voyages,
        (
          SELECT ROUND(COALESCE(SUM(sh.quantity_shipped), 0)::numeric, 2)
          FROM shipments sh
          JOIN contracts c ON c.id = sh.contract_id
          WHERE c.group_name = s.group_id
            AND sh.status NOT IN ('CANCELLED')
        )                            AS total_volume_shipped,
        (
          SELECT COUNT(DISTINCT sh.vessel_name)::int
          FROM shipments sh
          JOIN contracts c ON c.id = sh.contract_id
          WHERE c.group_name = s.group_id
            AND sh.vessel_name IS NOT NULL
            AND sh.status NOT IN ('CANCELLED')
        )                            AS unique_vessels,
        (
          SELECT ROUND(AVG(sh.total_lead_time_days)::numeric, 1)
          FROM shipments sh
          JOIN contracts c ON c.id = sh.contract_id
          WHERE c.group_name = s.group_id
            AND sh.total_lead_time_days IS NOT NULL
            AND sh.status NOT IN ('CANCELLED')
        )                            AS avg_lead_time_days,
        -- profile fields from supplier_groups
        sg.land_bank,
        sg.estimated_loading_rate,
        sg.pic,
        sg.company_type,
        sg.annual_turnover,
        sg.credit_rating,
        sg.credit_limit,
        sg.other_assets
      FROM suppliers s
      LEFT JOIN ${TABLE} sg ON sg.group_id = s.group_id
      ${whereClause}
      GROUP BY s.group_id, sg.land_bank, sg.estimated_loading_rate,
               sg.pic, sg.company_type, sg.annual_turnover, sg.credit_rating, sg.credit_limit, sg.other_assets
      ORDER BY s.group_id
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const countSql = `
      SELECT COUNT(DISTINCT s.group_id)::int AS count
      FROM suppliers s
      ${whereClause}
    `;

    const [dataRes, countRes] = await Promise.all([
      query(sql, [...params, limitNum, offset]),
      query(countSql, params),
    ]);

    return res.json({
      success: true,
      data: {
        items: dataRes.rows,
        total: countRes.rows[0].count,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    logger.error('Error listing supplier groups:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to list supplier groups' } });
  }
};

// Get single group profile
export const getSupplierGroup = async (req: AuthRequest, res: Response) => {
  try {
    const { group_id } = req.params;
    const result = await query(`SELECT * FROM ${TABLE} WHERE group_id = $1`, [group_id]);
    return res.json({ success: true, data: result.rows[0] || null });
  } catch (error) {
    logger.error('Error fetching supplier group:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch supplier group' } });
  }
};

// Upsert group profile (create or update)
export const upsertSupplierGroup = async (req: AuthRequest, res: Response) => {
  try {
    const { group_id } = req.params;
    const {
      land_bank, loading_method, estimated_loading_rate,
      pic, company_type, annual_turnover,
      credit_rating, credit_limit, other_assets,
    } = req.body;

    const n = (v: any) => (v === '' || v === undefined || v === null ? null : Number(v));
    const s = (v: any) => (v === '' || v === undefined || v === null ? null : String(v));

    const sql = `
      INSERT INTO ${TABLE} (
        group_id, land_bank, loading_method, estimated_loading_rate,
        pic, company_type, annual_turnover, credit_rating, credit_limit, other_assets
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (group_id) DO UPDATE SET
        land_bank              = EXCLUDED.land_bank,
        loading_method         = EXCLUDED.loading_method,
        estimated_loading_rate = EXCLUDED.estimated_loading_rate,
        pic                    = EXCLUDED.pic,
        company_type           = EXCLUDED.company_type,
        annual_turnover        = EXCLUDED.annual_turnover,
        credit_rating          = EXCLUDED.credit_rating,
        credit_limit           = EXCLUDED.credit_limit,
        other_assets           = EXCLUDED.other_assets,
        updated_at             = NOW()
      RETURNING *
    `;

    const result = await query(sql, [
      group_id,
      n(land_bank), s(loading_method), n(estimated_loading_rate),
      s(pic), s(company_type), n(annual_turnover),
      s(credit_rating), n(credit_limit), s(other_assets),
    ]);

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Error upserting supplier group:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to save supplier group profile' } });
  }
};
