import { Request, Response } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';

interface AuthRequest extends Request { user?: { id: string; role: string } }

const TABLE = 'products';

export const listProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '100', search = '' } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 100, 1), 500);
    const offset = (pageNum - 1) * limitNum;

    const where: string[] = [];
    const params: any[] = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`product_name ILIKE $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const dataRes = await query(
      `SELECT * FROM ${TABLE} ${whereSql} ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limitNum, offset]
    );
    const countRes = await query(`SELECT COUNT(*)::int AS count FROM ${TABLE} ${whereSql}`, params);
    res.json({ success: true, data: { items: dataRes.rows, total: countRes.rows[0].count, page: pageNum, limit: limitNum } });
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
      INSERT INTO ${TABLE} (product_name, percent_produce, working_hours_per_day, working_days_per_month, working_days_per_year)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `;
    const result = await query(sql, [product_name, percent_produce, working_hours_per_day, working_days_per_month, working_days_per_year]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    const msg = error?.code === '23505' ? 'Product with this name already exists' : (error?.message || 'Failed to create product');
    logger.error('Error creating product:', error);
    res.status(500).json({ success: false, error: { message: msg } });
  }
};

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const fields = ['product_name','percent_produce','working_hours_per_day','working_days_per_month','working_days_per_year'];
    const set: string[] = [];
    const params: any[] = [];
    const normalize = (v: any) => (v === '' || v === undefined ? null : v);
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
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Error updating product:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to update product' } });
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


