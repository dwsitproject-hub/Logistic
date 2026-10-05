import logger from '../utils/logger';
import { applyDhmMasterRecord, DHM_MASTER_SLUGS } from './applyMaster';
import { resolveDhmSlug } from './catalog';
import { dhmRequest } from './client';
import { isDhmEnabled } from './config';
import { applyDhmVesselRecord, getDhmSyncCursor, saveDhmSyncCursor } from './replica';
import type { DhmRecord } from './types';

interface SyncPage {
  records?: DhmRecord[];
  nextCursor?: string | null;
  hasMore?: boolean;
}

async function syncSlugPages(
  slug: string,
  apply: (record: DhmRecord) => Promise<boolean | void>,
  options?: { snapshot?: boolean; continueOnError?: boolean },
): Promise<{ applied: number; pages: number }> {
  let cursor = options?.snapshot ? null : await getDhmSyncCursor(slug);
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
      url: `/v1/sync/${slug}?${params.toString()}`,
    });
    if (status !== 200) {
      logger.warn('DHM sync page failed', { slug, status, cursor });
      break;
    }
    pages += 1;
    const records = Array.isArray(data?.records) ? data.records : [];
    for (const record of records) {
      try {
        // false = not written (older than the replica); only written records are counted.
        const written = await apply(record);
        if (written !== false) applied += 1;
      } catch (error) {
        logger.warn('DHM sync record skipped', { slug, recordId: record.id, error });
        if (!options?.continueOnError) throw error;
      }
      if (record.updatedAt && (!newestUpdatedAt || record.updatedAt > newestUpdatedAt)) {
        newestUpdatedAt = record.updatedAt;
      }
    }
    hasMore = Boolean(data?.hasMore && data.nextCursor);
    cursor = data?.nextCursor || null;
    if (cursor) {
      await saveDhmSyncCursor(slug, cursor, newestUpdatedAt);
    }
    if (!hasMore) break;
    if (pages > 200) {
      logger.warn('DHM sync stopped after 200 pages', { slug });
      break;
    }
  }

  logger.info('DHM sync finished', { slug, applied, pages });
  return { applied, pages };
}

export async function syncDhmVessels(options?: { snapshot?: boolean }): Promise<{
  applied: number;
  pages: number;
}> {
  if (!isDhmEnabled()) {
    return { applied: 0, pages: 0 };
  }
  // A snapshot rebuilds the replica from DHM, so it is not held back by the version guard (see versionGuard.ts).
  return syncSlugPages(
    'vessel',
    (record) => applyDhmVesselRecord(record, { force: options?.snapshot === true }).then((r) => r.skipped !== 'stale'),
    options,
  );
}

export async function syncDhmMasters(options?: { snapshot?: boolean }): Promise<{
  applied: number;
  pages: number;
}> {
  if (!isDhmEnabled()) {
    return { applied: 0, pages: 0 };
  }
  let applied = 0;
  let pages = 0;
  const seen = new Set<string>();
  for (const preferred of DHM_MASTER_SLUGS) {
    let slug: string = preferred;
    try {
      const resolved = await resolveDhmSlug(preferred);
      if (!resolved || seen.has(resolved)) {
        if (!resolved) logger.info('DHM sync skipped; slug not allowlisted', { slug: preferred });
        continue;
      }
      slug = resolved;
      seen.add(slug);
    } catch (error) {
      logger.warn('DHM catalog unavailable; remaining master sync skipped', { slug: preferred, error });
      break;
    }
    const page = await syncSlugPages(slug, (record) => applyDhmMasterRecord(slug, record, { force: options?.snapshot === true }), {
      ...options,
      continueOnError: true,
    });
    applied += page.applied;
    pages += page.pages;
  }
  return { applied, pages };
}
