/**
 * Push to DHM the vessels KLIP registered itself from a SAP vessel name (services/registerVesselFromSap.service.ts) and DHM has not linked yet.
 *
 * Runs after every DHM pull (the cron). Nothing in the SAP import calls DHM: the import must never wait on, or fail because of, another system, and a
 * vessel created inside the import's transaction is not even committed yet. So this looks for them afterwards:
 *
 *   registered_from = 'sap_auto'   KLIP created it from SAP
 *   dhm_id IS NULL                 DHM has not given it a record yet (a push that works, or one DHM answers "same name" to, writes the link)
 *   no dhm_push_state row          one that FAILED is the retry job's, one that is a CONFLICT waits for a person
 *   review_status <> PENDING       a vessel a person has not looked at may carry a name SAP cut at 35 characters; DHM refuses a second vessel
 *                                  with the same name but would keep the stump, so it is sent once someone approved (or corrected) it
 *
 * "Does DHM already have it?" is answered by DHM itself: it refuses a second vessel with the same name, and pushMasterVesselToDhm then links the
 * record DHM holds (a CONFLICT note remains on the Integrations page for a person to compare). Off when DHM is off.
 */
import { query } from '../database/connection';
import logger from '../utils/logger';
import { isDhmEnabled } from './config';
import { loadRowsByIds, pushRow } from './pushCatalog';

export interface DhmSapVesselPushSummary {
  disabled: boolean;
  attempted: number;
  synced: number;
  notDelivered: number;
}

export async function pushUnlinkedSapVessels(options: { limit?: number } = {}): Promise<DhmSapVesselPushSummary> {
  const summary: DhmSapVesselPushSummary = { disabled: false, attempted: 0, synced: 0, notDelivered: 0 };
  if (!isDhmEnabled()) return { ...summary, disabled: true };

  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const due = await query(
    `SELECT mv.id::text AS id
       FROM master_vessels mv
      WHERE mv.registered_from = 'sap_auto'
        AND mv.dhm_id IS NULL
        AND mv.review_status IS DISTINCT FROM 'PENDING'
        AND NOT EXISTS (SELECT 1 FROM dhm_push_state s WHERE s.entity_kind = 'vessel' AND s.entity_id = mv.id)
      ORDER BY mv.created_at
      LIMIT $1`,
    [limit],
  );
  const ids = (due.rows as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return summary;

  const rows = await loadRowsByIds('vessel', ids);
  for (const row of rows) {
    summary.attempted += 1;
    try {
      const result = await pushRow('vessel', row, false);
      if (result.dhmError || result.dhmConflict) summary.notDelivered += 1;
      else summary.synced += 1;
    } catch (error) {
      summary.notDelivered += 1;
      logger.warn('DHM push of a SAP-registered vessel failed', {
        vessel: String(row.vessel_name ?? ''),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (summary.attempted > 0) logger.info('DHM push of SAP-registered vessels', { ...summary });
  return summary;
}
