import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';

export const getMyPreference = async (req: AuthRequest, res: Response) => {
  try {
    const key = String((req.query as any).key || '').trim();
    if (!key) {
      return res.status(400).json({ success: false, error: { message: 'key is required' } });
    }
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
    }

    const result = await query(
      `SELECT pref_value FROM user_preferences WHERE user_id = $1 AND pref_key = $2 LIMIT 1`,
      [userId, key]
    );
    const value = result.rows?.[0]?.pref_value ?? null;
    return res.json({ success: true, data: { key, value } });
  } catch (error) {
    logger.error('Get my preference failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load preference' } });
  }
};

export const setMyPreference = async (req: AuthRequest, res: Response) => {
  try {
    const { key, value } = (req.body || {}) as { key?: string; value?: any };
    const k = String(key || '').trim();
    if (!k) {
      return res.status(400).json({ success: false, error: { message: 'key is required' } });
    }
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
    }

    await query(
      `
      INSERT INTO user_preferences (user_id, pref_key, pref_value, updated_at)
      VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, pref_key)
      DO UPDATE SET pref_value = EXCLUDED.pref_value, updated_at = CURRENT_TIMESTAMP
      `,
      [userId, k, JSON.stringify(value ?? null)]
    );

    return res.json({ success: true, data: { key: k, value } });
  } catch (error) {
    logger.error('Set my preference failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to save preference' } });
  }
};

