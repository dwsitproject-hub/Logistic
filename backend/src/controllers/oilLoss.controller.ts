import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { buildYtdOilLossSummary } from '../utils/oilLossSummary';
import { loadOilLossPayload } from '../services/oilLoss.service';

export const getOilLoss = async (_req: AuthRequest, res: Response) => {
  try {
    // Rows + gain come from the in-memory cache (identical queries, pre-run off the
    // request path). ytdSummary is recomputed per request because its YTD window
    // depends on the current date.
    const { rows, gainRow } = await loadOilLossPayload();
    const ytdSummary = buildYtdOilLossSummary(rows);
    return res.json({
      data: rows,
      ytdSummary,
      gainSummary: {
        totalGainKg: Number(gainRow.total_gain_kg),
        gainCount:   Number(gainRow.gain_count),
      },
      dataSources: {
        quantityDelivery:
          'Contracts qty_move + UAT Incoterm×Mode (same as Contracts View Table)|fallback SPD resolved',
        quantityReceive: 'Contracts qty_move.quantity_receive (same as Contracts View Table)|fallback SPD resolved',
        quantitySfal: 'sap_processed_data|shipments.sfal_qty',
        quantitySfbd: 'sap_processed_data|shipments.sfbd_qty',
      },
    });
  } catch (err) {
    console.error('Oil loss fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch oil loss data' });
  }
};
