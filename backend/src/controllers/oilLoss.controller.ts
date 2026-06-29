import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { buildYtdOilLossSummary } from '../utils/oilLossSummary';
import { buildOilLossGainSql, buildOilLossMainSql } from '../utils/oilLossQuerySql';

export const getOilLoss = async (_req: AuthRequest, res: Response) => {
  try {
    const sql = buildOilLossMainSql();
    const gainSql = buildOilLossGainSql();

    const [result, gainResult] = await Promise.all([query(sql), query(gainSql)]);
    const gainRow = gainResult.rows[0] ?? { total_gain_kg: 0, gain_count: 0 };
    const ytdSummary = buildYtdOilLossSummary(result.rows);
    return res.json({
      data: result.rows,
      ytdSummary,
      gainSummary: {
        totalGainKg: Number(gainRow.total_gain_kg),
        gainCount:   Number(gainRow.gain_count),
      },
      dataSources: {
        quantityDelivery: 'sap_processed_data|shipments.quantity_delivered',
        quantityReceive: 'sap_processed_data|shipments.actual_vessel_qty_receive',
        quantitySfal: 'sap_processed_data|shipments.sfal_qty',
        quantitySfbd: 'sap_processed_data|shipments.sfbd_qty',
      },
    });
  } catch (err) {
    console.error('Oil loss fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch oil loss data' });
  }
};
