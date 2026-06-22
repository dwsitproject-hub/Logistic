import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import {
  listAiKlipAgentActivityLogs,
  listAiKlipAgentNames,
} from '../services/aiKlipAgentActivityLog.service';

export const getAiKlipAgentActivityLogs = async (req: AuthRequest, res: Response) => {
  try {
    const { dateFrom, dateTo, agentName, page, limit } = req.query;
    const data = await listAiKlipAgentActivityLogs({
      dateFrom: dateFrom ? String(dateFrom).slice(0, 10) : undefined,
      dateTo: dateTo ? String(dateTo).slice(0, 10) : undefined,
      agentName: agentName ? String(agentName).trim() : undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('getAiKlipAgentActivityLogs error', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load AI Klip Agent activity logs' },
    });
  }
};

export const getAiKlipAgentNames = async (_req: AuthRequest, res: Response) => {
  try {
    const agents = await listAiKlipAgentNames();
    return res.json({ success: true, data: { agents } });
  } catch (error) {
    logger.error('getAiKlipAgentNames error', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load AI agent list' },
    });
  }
};
