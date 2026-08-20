import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  ingestUserActivityEvents,
  listUserActivityDailyDetail,
  listUserActivityDailySummary,
  type IngestUserActivityEvent,
} from '../services/userActivityLog.service';
import {
  InvalidDateInputError,
  parseOptionalStrictDateOnly,
  parseOptionalStrictDateRange,
} from '../utils/strictDateInput';

export async function postUserActivityEvents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      return;
    }

    const body = req.body as { events?: IngestUserActivityEvent[] };
    const events = Array.isArray(body?.events) ? body.events : [];
    const inserted = await ingestUserActivityEvents(userId, events);

    res.json({ success: true, data: { inserted } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Failed to record activity' },
    });
  }
}

export async function getUserActivityDailySummary(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId, page, limit } = req.query;
    const { dateFrom, dateTo } = parseOptionalStrictDateRange({
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    });
    const data = await listUserActivityDailySummary({
      dateFrom,
      dateTo,
      userId: typeof userId === 'string' ? userId : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof InvalidDateInputError) {
      res.status(400).json({ success: false, error: { message: error.message } });
      return;
    }
    res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Failed to load activity summary' },
    });
  }
}

export async function getUserActivityDailyDetail(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    let activityDate: string;
    try {
      activityDate = parseOptionalStrictDateOnly(req.query.date, 'date') ?? '';
    } catch (error) {
      if (error instanceof InvalidDateInputError) {
        res.status(400).json({ success: false, error: { message: error.message } });
        return;
      }
      throw error;
    }
    if (!userId || !activityDate) {
      res.status(400).json({
        success: false,
        error: { message: 'userId and date are required' },
      });
      return;
    }

    const data = await listUserActivityDailyDetail(userId, activityDate);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Failed to load activity detail' },
    });
  }
}
