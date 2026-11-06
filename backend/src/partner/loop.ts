import { query } from '../database/connection';
import { onIntegrationSettingsChanged } from '../integrations/integrationEnv';
import logger from '../utils/logger';
import { isKmapsEnabled, isKmapsWebhookConfigured } from './config';
import { pruneDeliveries, sendDueDeliveries } from './deliveries';
import { refreshPartnerRecords } from './refresh';

/**
 * Keeps partner_shipment_records current while the KMAPS integration is on.
 *
 * Every minute it asks whether the sources changed (a few cheap aggregate reads) and rebuilds only if they did, but never more often than every
 * MIN_GAP_SECONDS: during a SAP import the sources change constantly, and the rebuild is a full Shipments-scope derivation. The first run waits after boot so it
 * does not compete with the startup snapshot refreshes (a heavy build on top of those once ran the database out of memory).
 *
 * Not registered in SchedulerService on purpose: that file is edited by other work in progress, and this loop needs no cron expression or restart - it reads
 * KMAPS_ENABLED on every tick, so switching the integration on or off takes effect at once.
 */
const TICK_MS = 60_000;
const FIRST_RUN_DELAY_MS = 3 * 60_000;
const MIN_GAP_SECONDS = 120;
/** The bells are sent (and retried) on their own, faster clock: the first retry is 30 seconds after a failure. */
const SEND_TICK_MS = 15_000;

let started = false;

async function tick(reason: string): Promise<void> {
  if (!isKmapsEnabled()) return;
  try {
    const gap = await query(`SELECT EXTRACT(EPOCH FROM (NOW() - refreshed_at))::int AS s FROM partner_snapshot_state WHERE id = 1`);
    const secondsSince = gap.rows[0]?.s as number | null | undefined;
    if (secondsSince !== null && secondsSince !== undefined && secondsSince < MIN_GAP_SECONDS) return;
    const result = await refreshPartnerRecords();
    if (result.refreshed) logger.info('KMAPS partner records up to date', { reason, ...result, changedRecordIds: result.changedRecordIds.length });
  } catch (error) {
    // refreshPartnerRecords has logged and recorded the failure; the next tick tries again.
    void error;
  }
}

async function sendTick(): Promise<void> {
  if (!isKmapsWebhookConfigured()) return;
  await sendDueDeliveries();
}

export function startPartnerRefreshLoop(): void {
  if (started || process.env.NODE_ENV === 'test') return;
  started = true;
  setTimeout(() => void tick('boot'), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void tick('interval'), TICK_MS).unref();
  setInterval(() => void sendTick(), SEND_TICK_MS).unref();
  setInterval(() => void pruneDeliveries().catch(() => undefined), 6 * 60 * 60_000).unref();
  // Saving settings (for example switching the integration on) should not wait for the next tick.
  onIntegrationSettingsChanged(() => void tick('settings'));
}
