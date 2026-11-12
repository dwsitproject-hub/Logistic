import { wantsExcludeDhmDeleted } from '../utils/dhmDeletedFilter';
import { Request, Response } from 'express';
import { query } from '../database/connection';
import { attachDhmPushState, productDhmExtra, pushNamedMasterToDhm } from '../dhm';
import logger from '../utils/logger';
import { logAudit } from '../middleware/audit';

interface AuthRequest extends Request { user?: { id: string; role: string } }

const TABLE = 'products';

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

export const listProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '100', search = '', excludeDeleted } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 500);
    const offset = (pageNum - 1) * limitNum;

    const where: string[] = [];
    const params: any[] = [];
    // Pickers pass excludeDeleted=true; the Master Product table does not, so it still lists every row.
    if (wantsExcludeDhmDeleted(excludeDeleted)) where.push('COALESCE(dhm_is_deleted, FALSE) IS NOT TRUE');
    if (search) {
      params.push(`%${search}%`);
      where.push(`(product_name ILIKE $${params.length} OR long_name ILIKE $${params.length} OR commodity_type ILIKE $${params.length} OR material_code ILIKE $${params.length} OR code_klip ILIKE $${params.length} OR code_dhm ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const dataRes = await query(
      `SELECT * FROM ${TABLE} ${whereSql} ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limitNum, offset]
    );
    const countRes = await query(`SELECT COUNT(*)::int AS count FROM ${TABLE} ${whereSql}`, params);
    res.json({ success: true, data: { items: await attachDhmPushState('product', dataRes.rows), total: countRes.rows[0].count, page: pageNum, limit: limitNum } });
  } catch (error) {
    logger.error('Error listing products:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to list products' } });
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MATERIAL_SELECT = `
  SELECT m.id, m.material_code, m.material_description, m.product_id, p.product_name, m.product_label, m.product_link_source,
         m.code_dhm, COALESCE(m.dhm_is_deleted, FALSE) AS dhm_is_deleted, COALESCE(cc.n, 0)::int AS contracts, m.last_seen_at
    FROM product_materials m
    LEFT JOIN products p ON p.id = m.product_id
    LEFT JOIN (SELECT UPPER(TRIM(material_code)) AS k, COUNT(*) AS n FROM contracts WHERE NULLIF(TRIM(material_code), '') IS NOT NULL GROUP BY 1) cc
           ON cc.k = UPPER(TRIM(m.material_code))`;

/**
 * The SAP materials under the Master Products (product_materials, migration 265): the smallest unit of a commodity and the key of its DHM code. Read only here; the SAP import fills
 * the list, the DHM sync fills the code. `status`: all | unlinked (no Master Product yet) | no_dhm (no DHM code yet).
 */
export const listProductMaterials = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search = '', status = 'all' } = req.query as Record<string, string>;
    const where: string[] = [];
    const params: unknown[] = [];
    const term = String(search).trim();
    if (term) {
      params.push(`%${term}%`);
      const p = `$${params.length}`;
      where.push(`(m.material_code ILIKE ${p} OR m.material_description ILIKE ${p} OR p.product_name ILIKE ${p} OR m.product_label ILIKE ${p} OR m.code_dhm ILIKE ${p})`);
    }
    if (status === 'unlinked') where.push('m.product_id IS NULL');
    if (status === 'no_dhm') where.push("NULLIF(TRIM(m.code_dhm), '') IS NULL");
    const items = await query(
      `${MATERIAL_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (m.product_id IS NULL) DESC, COALESCE(p.product_name, m.product_label, '~'), m.material_code
       LIMIT 1000`,
      params,
    );
    const summary = await query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE product_id IS NULL)::int AS unlinked,
              COUNT(*) FILTER (WHERE NULLIF(TRIM(code_dhm), '') IS NULL)::int AS no_dhm FROM product_materials`,
    );
    const products = await query(`SELECT id, product_name FROM products WHERE COALESCE(dhm_is_deleted, FALSE) IS NOT TRUE ORDER BY product_name`);
    res.json({ success: true, data: { items: items.rows, summary: summary.rows[0], products: products.rows } });
  } catch (error) {
    logger.error('Error listing product materials:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to load SAP materials' } });
  }
};

/**
 * Link a SAP material to a Master Product (or take the link off with product_id null). A link set here is a person's: the SAP import never changes it again.
 */
export const linkProductMaterial = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!UUID_RE.test(String(id))) { res.status(400).json({ success: false, error: { message: 'Invalid material id' } }); return; }
    const raw = (req.body as { product_id?: unknown })?.product_id;
    const productId = raw === null || raw === undefined || raw === '' ? null : String(raw);
    if (productId !== null && !UUID_RE.test(productId)) { res.status(400).json({ success: false, error: { message: 'Invalid product id' } }); return; }
    if (productId !== null) {
      const exists = await query('SELECT 1 FROM products WHERE id = $1', [productId]);
      if (exists.rowCount === 0) { res.status(404).json({ success: false, error: { message: 'Product not found' } }); return; }
    }
    const before = await query(`${MATERIAL_SELECT} WHERE m.id = $1`, [id]);
    if (before.rowCount === 0) { res.status(404).json({ success: false, error: { message: 'Material not found' } }); return; }
    await query(`UPDATE product_materials SET product_id = $2, product_link_source = 'USER', updated_at = NOW() WHERE id = $1`, [id, productId]);
    const after = await query(`${MATERIAL_SELECT} WHERE m.id = $1`, [id]);
    try {
      await logAudit(req as never, 'UPDATE', 'PRODUCT_MATERIAL', id, before.rows[0], after.rows[0]);
    } catch (auditError) {
      logger.warn('Could not audit the product material link', { auditError });
    }
    res.json({ success: true, data: after.rows[0] });
  } catch (error) {
    logger.error('Error linking product material:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to link the material' } });
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


