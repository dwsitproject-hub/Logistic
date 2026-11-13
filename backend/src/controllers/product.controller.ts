import { wantsExcludeDhmDeleted } from '../utils/dhmDeletedFilter';
import { Request, Response } from 'express';
import { query } from '../database/connection';
import { attachDhmPushState, productDhmExtra, pushNamedMasterToDhm } from '../dhm';
import logger from '../utils/logger';
import { masterDhmConditions, masterDhmFilterClause, parseMasterDhmFilter, type MasterDhmSource } from '../utils/masterDhmFilter';

interface AuthRequest extends Request { user?: { id: string; role: string } }

const TABLE = 'products';

/** DHM link of a product: dhm_id or code_dhm; undelivered pushes are recorded as kind 'product'. */
const PRODUCT_DHM: Pick<MasterDhmSource, 'kind'> = { kind: 'product' };

function wantsDhmOverwrite(req: AuthRequest): boolean {
  const q = String((req.query as { dhmOverwrite?: unknown }).dhmOverwrite ?? '').toLowerCase();
  return q === 'true' || q === '1';
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

/** A unique-index violation on products: the Material Code index says so by name, everything else is the product name. */
function duplicateMessage(error: { constraint?: string }): string {
  return String(error?.constraint || '').includes('material_code')
    ? 'Another product already has this Material Code'
    : 'Product with this name already exists';
}

async function pushProduct(row: Record<string, unknown>, overwrite: boolean) {
  const name = String(row.product_name ?? '').trim();
  return pushNamedMasterToDhm(
    'products',
    String(row.id),
    'commodity',
    name,
    row.code_dhm != null ? String(row.code_dhm) : null,
    { overwrite, extra: productDhmExtra(row) },
  );
}

export interface ProductListQuery {
  search?: string;
  excludeDeleted?: string;
  withUsage?: string;
  usedInKlip?: string;
  dhm?: string;
}

/**
 * The list and count SQL of GET /products. Kept apart from the handler so a test can run it against a real database: a mocked query only shows the text, and the alias
 * the DHM status clause needs (p when the usage join is on, products when it is not) is exactly what a text check cannot prove.
 */
export function buildProductListSql(
  q: ProductListQuery,
  limitNum: number,
  offset: number,
): { dataSql: string; dataParams: any[]; countSql: string; countParams: any[] } {
  const { search = '', excludeDeleted, withUsage, usedInKlip, dhm } = q;
  const where: string[] = [];
  const params: any[] = [];
  // Pickers pass excludeDeleted=true; the Master Product table does not, so it still lists every row.
  if (wantsExcludeDhmDeleted(excludeDeleted)) where.push('COALESCE(dhm_is_deleted, FALSE) IS NOT TRUE');
  if (search) {
    params.push(`%${search}%`);
    where.push(`(product_name ILIKE $${params.length} OR long_name ILIKE $${params.length} OR commodity_type ILIKE $${params.length} OR material_code ILIKE $${params.length} OR code_klip ILIKE $${params.length} OR code_dhm ILIKE $${params.length})`);
  }
  // The Master Product table asks for withUsage: the KLIP product (contracts.product, the SAP text) that contracts carry for each row's material_code, and how many contracts use it. Derived on read,
  // nothing is stored; pickers do not ask, so their query is unchanged. usedInKlip keeps only the rows some contract uses.
  const usageOn = /^(true|1)$/i.test(String(withUsage ?? '')) || /^(true|1)$/i.test(String(usedInKlip ?? ''));
  if (/^(true|1)$/i.test(String(usedInKlip ?? ''))) where.push('u.contracts IS NOT NULL');
  // DHM status (Synced / Not synced / Failed) of the Master Product page, judged here because the list is paged. The table is aliased p when the usage join is on.
  const dhmClause = masterDhmFilterClause(parseMasterDhmFilter(dhm), { ...PRODUCT_DHM, table: usageOn ? 'p' : TABLE });
  if (dhmClause) where.push(dhmClause);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const usageCte = usageOn
    ? `WITH usage AS (
         SELECT upper(trim(material_code)) AS mc, mode() WITHIN GROUP (ORDER BY product) AS klip_product, COUNT(*)::int AS contracts
           FROM contracts
          WHERE NULLIF(trim(material_code), '') IS NOT NULL
          GROUP BY 1
       )`
    : '';
  const fromSql = usageOn ? `${TABLE} p LEFT JOIN usage u ON u.mc = upper(trim(p.material_code))` : TABLE;
  const selectSql = usageOn ? 'p.*, u.klip_product, COALESCE(u.contracts, 0) AS klip_contracts' : '*';
  const orderSql = usageOn ? 'p.updated_at DESC NULLS LAST, p.created_at DESC' : 'updated_at DESC NULLS LAST, created_at DESC';

  return {
    dataSql: `${usageCte} SELECT ${selectSql} FROM ${fromSql} ${whereSql} ORDER BY ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    dataParams: [...params, limitNum, offset],
    countSql: `${usageCte} SELECT COUNT(*)::int AS count FROM ${fromSql} ${whereSql}`,
    countParams: params,
  };
}

export const listProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '100' } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 500);
    const offset = (pageNum - 1) * limitNum;
    const built = buildProductListSql(req.query as ProductListQuery, limitNum, offset);
    const dataRes = await query(built.dataSql, built.dataParams);
    const countRes = await query(built.countSql, built.countParams);
    res.json({ success: true, data: { items: await attachDhmPushState('product', dataRes.rows), total: countRes.rows[0].count, page: pageNum, limit: limitNum } });
  } catch (error) {
    logger.error('Error listing products:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to list products' } });
  }
};

/**
 * The SQL of the cards above the Master Product list. "Used in KLIP" is the page's own definition: a product some contract carries the Material Code of (the same match as the
 * Contracts column and the "Used in KLIP only" filter, and the set the DHM Sync pushes). The DHM counts come twice: over the whole catalog, and over the used products only,
 * because the page opens on the used products and the Sync only sends those, so the cards follow the scope the list is showing.
 */
export function productSummarySql(): string {
  const { failed, linked } = masterDhmConditions({ table: TABLE, ...PRODUCT_DHM });
  const used = `upper(trim(${TABLE}.material_code)) IN (SELECT mc FROM used_codes)`;
  return `WITH used_codes AS (
       SELECT DISTINCT upper(trim(material_code)) AS mc FROM contracts WHERE NULLIF(trim(material_code), '') IS NOT NULL
     )
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ${used})::int AS used_in_klip,
            COUNT(*) FILTER (WHERE NOT ${failed} AND ${linked})::int AS synced,
            COUNT(*) FILTER (WHERE NOT ${failed} AND NOT ${linked})::int AS not_synced,
            COUNT(*) FILTER (WHERE ${failed})::int AS failed,
            COUNT(*) FILTER (WHERE ${used} AND NOT ${failed} AND ${linked})::int AS used_synced,
            COUNT(*) FILTER (WHERE ${used} AND NOT ${failed} AND NOT ${linked})::int AS used_not_synced,
            COUNT(*) FILTER (WHERE ${used} AND ${failed})::int AS used_failed
     FROM ${TABLE}`;
}

/** GET /products/summary: the numbers of the Master Product cards (all rows, never the page or the filters on screen). */
export const getProductSummary = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await query(productSummarySql());
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    const n = (key: string) => Number(row[key] ?? 0);
    res.json({
      success: true,
      data: {
        total: n('total'),
        usedInKlip: n('used_in_klip'),
        synced: n('synced'),
        notSynced: n('not_synced'),
        failed: n('failed'),
        usedSynced: n('used_synced'),
        usedNotSynced: n('used_not_synced'),
        usedFailed: n('used_failed'),
      },
    });
  } catch (error) {
    logger.error('Product summary error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to load the Master Product summary' } });
  }
};

export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const normalize = (v: any) => (v === '' || v === undefined ? null : v);
    const { product_name } = req.body;
    if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
      res.status(400).json({ success: false, error: { message: 'Product Name is required' } });
      return;
    }
    const percent_produce = normalize(req.body.percent_produce);
    const working_hours_per_day = normalize(req.body.working_hours_per_day);
    const working_days_per_month = normalize(req.body.working_days_per_month);
    const working_days_per_year = normalize(req.body.working_days_per_year);
    const sql = `
      INSERT INTO ${TABLE} (
        product_name, long_name, commodity_type,
        percent_produce, working_hours_per_day, working_days_per_month, working_days_per_year,
        material_code, material_group, hs_code, uom
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `;
    const result = await query(sql, [
      product_name.trim(),
      textOrNull(req.body.long_name),
      textOrNull(req.body.commodity_type),
      percent_produce,
      working_hours_per_day,
      working_days_per_month,
      working_days_per_year,
      textOrNull(req.body.material_code),
      textOrNull(req.body.material_group),
      textOrNull(req.body.hs_code),
      textOrNull(req.body.uom),
    ]);
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushProduct(saved, wantsDhmOverwrite(req));
    const refreshed = await query(`SELECT * FROM ${TABLE} WHERE id = $1`, [saved.id]);
    res.status(201).json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
  } catch (error: any) {
    const msg = error?.code === '23505' ? duplicateMessage(error) : (error?.message || 'Failed to create product');
    logger.error('Error creating product:', error);
    res.status(500).json({ success: false, error: { message: msg } });
  }
};

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const fields = ['product_name','long_name','commodity_type','percent_produce','working_hours_per_day','working_days_per_month','working_days_per_year','material_code','material_group','hs_code','uom'];
    const set: string[] = [];
    const params: any[] = [];
    const normalize = (v: any) => (v === '' || v === undefined ? null : typeof v === 'string' ? v.trim() || null : v);
    fields.forEach((f) => {
      if (f in req.body) {
        params.push(normalize((req.body as any)[f]));
        set.push(`${f} = $${params.length}`);
      }
    });
    if (set.length === 0) { res.status(400).json({ success: false, error: { message: 'No fields to update' } }); return; }
    const sql = `UPDATE ${TABLE} SET ${set.join(', ')}, updated_at = NOW() WHERE id = $${params.length + 1} RETURNING *`;
    params.push(id);
    const result = await query(sql, params);
    if (result.rowCount === 0) { res.status(404).json({ success: false, error: { message: 'Product not found' } }); return; }
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushProduct(saved, wantsDhmOverwrite(req));
    const refreshed = await query(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
    res.json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
  } catch (error: any) {
    logger.error('Error updating product:', error);
    const message = error?.code === '23505' ? duplicateMessage(error) : 'Failed to update product';
    res.status(error?.code === '23505' ? 409 : 500).json({ success: false, error: { message } });
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await query(`DELETE FROM ${TABLE} WHERE id = $1 RETURNING id`, [id]);
    if (result.rowCount === 0) { res.status(404).json({ success: false, error: { message: 'Product not found' } }); return; }
    res.json({ success: true, data: { id } });
  } catch (error) {
    logger.error('Error deleting product:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete product' } });
  }
};


