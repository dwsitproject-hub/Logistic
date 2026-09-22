import logger from '../utils/logger';
import { dhmRequest } from './client';
import { isDhmEnabled } from './config';
import { applyDhmVesselRecord, getDhmSyncCursor, saveDhmSyncCursor } from './replica';
import type { DhmRecord } from './types';

interface SyncPage {
  records?: DhmRecord[];
  nextCursor?: string | null;
  hasMore?: boolean;
}

export async function syncDhmVessels(options?: { snapshot?: boolean }): Promise<{
  applied: number;
  pages: number;
}> {
  if (!isDhmEnabled()) {
    return { applied: 0, pages: 0 };
  }

  let cursor = options?.snapshot ? null : await getDhmSyncCursor('vessel');
  let applied = 0;
  let pages = 0;
  let hasMore = true;
  let newestUpdatedAt: string | null = null;

  while (hasMore) {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (cursor) params.set('cursor', cursor);
    const { status, data } = await dhmRequest<SyncPage>({
      method: 'GET',
      url: `/v1/sync/vessel?${params.toString()}`,
    });
    if (status !== 200) {
      logger.warn('DHM vessel sync page failed', { status, cursor });
      break;
    }
    pages += 1;
    const records = Array.isArray(data?.records) ? data.records : [];
    for (const record of records) {
      await applyDhmVesselRecord(record);
      applied += 1;
      if (record.updatedAt && (!newestUpdatedAt || record.updatedAt > newestUpdatedAt)) {
        newestUpdatedAt = record.updatedAt;
      }
    }
    hasMore = Boolean(data?.hasMore && data.nextCursor);
    cursor = data?.nextCursor || null;
    if (cursor) {
      await saveDhmSyncCursor('vessel', cursor, newestUpdatedAt);
    }
    if (!hasMore) break;
    if (pages > 200) {
      logger.warn('DHM vessel sync stopped after 200 pages');
      break;
    }
  }

  logger.info('DHM vessel sync finished', { applied, pages });
  return { applied, pages };
}
