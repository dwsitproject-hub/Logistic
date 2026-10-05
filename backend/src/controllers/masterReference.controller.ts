import { Response } from 'express';
import { attachDhmPushState, pushMasterExternalPartyToDhm, pushNamedMasterToDhm } from '../dhm';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';

const KINDS = {
  ext_company: { prefix: 'KEXT', sequence: 'master_ext_company_klip_code_seq', fields: 3 },
  incoterm: { prefix: 'KINC', sequence: 'master_incoterm_klip_code_seq', fields: 1 },
  truck_transporter: { prefix: 'KTRN', sequence: 'master_truck_transporter_klip_code_seq', fields: 1 },
} as const;

type ReferenceKind = keyof typeof KINDS;

function readKind(value: unknown): ReferenceKind | null {
  const kind = String(value ?? '').trim();
  return kind in KINDS ? (kind as ReferenceKind) : null;
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function wantsDhmOverwrite(req: AuthRequest): boolean {
  const q = String((req.query as { dhmOverwrite?: unknown }).dhmOverwrite ?? '').toLowerCase();
  return q === 'true' || q === '1';
}

async function pushReference(kind: ReferenceKind, row: Record<string, unknown>, overwrite: boolean) {
  if (kind === 'truck_transporter') return {};
  if (kind === 'ext_company') return pushMasterExternalPartyToDhm(String(row.id), row, { overwrite });
  return pushNamedMasterToDhm(
    'master_reference_items',
    String(row.id),
    'incoterm',
    String(row.value_1 ?? ''),
    row.code_dhm != null ? String(row.code_dhm) : null,
    { overwrite },
  );
}

export const listMasterReferences = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const kind = readKind(req.params.kind);
    if (!kind) {
      res.status(400).json({ success: false, error: { message: 'Unknown master reference' } });
      return;
    }
    const { search = '', page = '1', limit = '20' } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 500);
    const offset = (pageNum - 1) * limitNum;
    const params: unknown[] = [kind];
    let where = 'WHERE kind = $1';
    const term = search.trim();
    if (term) {
      params.push(`%${term}%`);
      where += ` AND (
        code_klip ILIKE $${params.length}
        OR code_dhm ILIKE $${params.length}
        OR value_1 ILIKE $${params.length}
        OR value_2 ILIKE $${params.length}
        OR value_3 ILIKE $${params.length}
      )`;
    }
    const [listResult, countResult] = await Promise.all([
      query(
        `SELECT id, kind, code_klip, code_dhm, value_1, value_2, value_3, created_at, updated_at
         FROM master_reference_items
         ${where}
         ORDER BY value_1, value_2 NULLS FIRST, value_3 NULLS FIRST
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limitNum, offset],
      ),
      query(`SELECT COUNT(*)::int AS count FROM master_reference_items ${where}`, params),
    ]);
    res.json({
      success: true,
      data: {
        // Truck Transporter has no DHM slug, so there is nothing of it to be undelivered.
        items:
          kind === 'incoterm' || kind === 'ext_company'
            ? await attachDhmPushState(kind, listResult.rows)
            : listResult.rows,
        total: countResult.rows[0]?.count ?? 0,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    logger.error('List master reference error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to list master reference' } });
  }
};

export const createMasterReference = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const kind = readKind(req.params.kind);
    if (!kind) {
      res.status(400).json({ success: false, error: { message: 'Unknown master reference' } });
      return;
    }
    const spec = KINDS[kind];
    const value1 = textOrNull(req.body?.value_1);
    const value2 = textOrNull(req.body?.value_2);
    const value3 = textOrNull(req.body?.value_3);
    if (!value1 && spec.fields === 1) {
      res.status(400).json({ success: false, error: { message: 'Name is required' } });
      return;
    }
    if (kind === 'ext_company' && !value3) {
      res.status(400).json({ success: false, error: { message: 'Company Name is required' } });
      return;
    }
    const storedValue1 = kind === 'ext_company' ? value1 ?? '' : value1;
    if (!storedValue1 && kind !== 'ext_company') {
      res.status(400).json({ success: false, error: { message: 'Name is required' } });
      return;
    }
    const result = await query(
      `INSERT INTO master_reference_items (kind, code_klip, value_1, value_2, value_3)
       VALUES ($1, $2 || lpad(nextval('${spec.sequence}')::text, 4, '0'), $3, $4, $5)
       RETURNING *`,
      [kind, `${spec.prefix}-`, storedValue1, value2, value3],
    );
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushReference(kind, saved, wantsDhmOverwrite(req));
    const refreshed = await query(`SELECT * FROM master_reference_items WHERE id = $1`, [saved.id]);
    res.status(201).json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    logger.error('Create master reference error:', error);
    res.status(code === '23505' ? 400 : 500).json({
      success: false,
      error: { message: code === '23505' ? 'This master row already exists' : 'Failed to create master reference' },
    });
  }
};

export const updateMasterReference = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const kind = readKind(req.params.kind);
    if (!kind) {
      res.status(400).json({ success: false, error: { message: 'Unknown master reference' } });
      return;
    }
    const value1 = textOrNull(req.body?.value_1);
    const value2 = textOrNull(req.body?.value_2);
    const value3 = textOrNull(req.body?.value_3);
    if (kind === 'ext_company' && !value3) {
      res.status(400).json({ success: false, error: { message: 'Company Name is required' } });
      return;
    }
    if (kind !== 'ext_company' && !value1) {
      res.status(400).json({ success: false, error: { message: 'Name is required' } });
      return;
    }
    const result = await query(
      `UPDATE master_reference_items
       SET value_1 = $1, value_2 = $2, value_3 = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND kind = $5
       RETURNING *`,
      [kind === 'ext_company' ? value1 ?? '' : value1, value2, value3, req.params.id, kind],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master row not found' } });
      return;
    }
    const saved = result.rows[0] as Record<string, unknown>;
    const dhm = await pushReference(kind, saved, wantsDhmOverwrite(req));
    const refreshed = await query(`SELECT * FROM master_reference_items WHERE id = $1`, [saved.id]);
    res.json({ success: true, data: { ...(refreshed.rows[0] ?? saved), ...dhm } });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    logger.error('Update master reference error:', error);
    res.status(code === '23505' ? 400 : 500).json({
      success: false,
      error: { message: code === '23505' ? 'This master row already exists' : 'Failed to update master reference' },
    });
  }
};

export const deleteMasterReference = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const kind = readKind(req.params.kind);
    if (!kind) {
      res.status(400).json({ success: false, error: { message: 'Unknown master reference' } });
      return;
    }
    const result = await query(
      `DELETE FROM master_reference_items WHERE id = $1 AND kind = $2 RETURNING id`,
      [req.params.id, kind],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: { message: 'Master row not found' } });
      return;
    }
    res.json({ success: true, data: { id: req.params.id } });
  } catch (error) {
    logger.error('Delete master reference error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to delete master reference' } });
  }
};
