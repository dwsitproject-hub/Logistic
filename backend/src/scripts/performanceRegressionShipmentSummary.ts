/**
 * Regression: shipment Section 1 summary — daily table vs live SQL must match (toolbar scope).
 * Run (host + DB): npm run regression:shipment-summary-parity
 * Run (Docker, hits running API): docker exec klip-backend node dist/scripts/performanceRegressionShipmentSummary.js
 */
import { query } from '../database/connection';
import {
  PipelineDailySummaryService,
  loadShipmentSummaryFromDaily,
  markPipelineDailySummaryStale,
} from '../services/pipelineDailySummary.service';
import { invalidateShipmentsListCache } from '../services/shipmentList.service';
import logger from '../utils/logger';

const SUMMARY_FIELDS = [
  'total',
  'status',
  'loadingPortBreakdown',
  'dischargePortBreakdown',
  'etaLoading',
  'etaDischarge',
  'unplannedTable',
] as const;

const API_BASE = (process.env.API_BASE || 'http://127.0.0.1:5001').replace(/\/$/, '');

function ytdRange(): { dateFrom: string; dateTo: string } {
  const yr = new Date().getFullYear();
  const dateTo = new Date().toISOString().slice(0, 10);
  return { dateFrom: `${yr}-01-01`, dateTo };
}

async function login(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@klip.com', password: 'admin123' }),
  });
  const body = (await res.json()) as { data?: { token?: string }; error?: unknown };
  if (!res.ok || !body.data?.token) {
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.data.token;
}

async function fetchSummary(token: string, range: { dateFrom: string; dateTo: string }) {
  const uri = `${API_BASE}/api/shipments?summaryOnly=true&compact=true&limit=1&dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`;
  const res = await fetch(uri, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { data?: { summary?: Record<string, unknown> }; error?: unknown };
  if (!res.ok) {
    throw new Error(`GET summary failed: ${res.status} ${JSON.stringify(body)}`);
  }
  if (!body.data?.summary) {
    throw new Error('GET summary missing data.summary');
  }
  return body.data.summary;
}

function pickSummaryShape(summary: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SUMMARY_FIELDS) {
    out[key] = summary[key];
  }
  return out;
}

function diffSummaries(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const jsonA = JSON.stringify(a);
  const jsonB = JSON.stringify(b);
  if (jsonA !== jsonB) {
    errors.push(`summary mismatch:\n  daily=${jsonA}\n  live=${jsonB}`);
  }
  return errors;
}

async function assertDailyTableMatchesLoader(range: { dateFrom: string; dateTo: string }): Promise<void> {
  const fromDaily = await loadShipmentSummaryFromDaily({
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    plants: [],
  });
  if (!fromDaily) {
    throw new Error('loadShipmentSummaryFromDaily returned null — refresh meta stale or empty table');
  }

  const params: unknown[] = [];
  let where = 'WHERE 1=1';
  if (range.dateFrom) {
    params.push(range.dateFrom);
    where += ` AND contract_date >= $${params.length}::date`;
  }
  if (range.dateTo) {
    params.push(range.dateTo);
    where += ` AND contract_date <= $${params.length}::date`;
  }

  const db = await query(
    `SELECT
      COALESCE(SUM(total_count), 0)::bigint AS total_count,
      COALESCE(SUM(planned_count), 0)::bigint AS planned_count,
      COALESCE(SUM(unplanned_contract_backlog), 0)::bigint AS unplanned_contract_backlog,
      COALESCE(SUM(unplanned_shipment_execution), 0)::bigint AS unplanned_shipment_execution
    FROM shipment_pipeline_daily_summary ${where}`,
    params,
  );
  const row = db.rows[0] as Record<string, unknown>;
  if (Number(row.total_count) !== fromDaily.totalCount) {
    throw new Error(`Daily loader total ${fromDaily.totalCount} != DB sum ${row.total_count}`);
  }
  if (Number(row.planned_count) !== Number(fromDaily.summaryRow.planned_count || 0)) {
    throw new Error('Daily loader planned != DB sum planned');
  }
}

async function main(): Promise<void> {
  logger.info('Performance regression: shipment summary parity (daily vs live)', { API_BASE });
  const range = ytdRange();

  logger.info('Refreshing pipeline daily summaries...');
  await PipelineDailySummaryService.refreshAll();

  await assertDailyTableMatchesLoader(range);

  const token = await login();
  invalidateShipmentsListCache();

  const dailySummary = pickSummaryShape(await fetchSummary(token, range));

  await markPipelineDailySummaryStale(['shipment']);
  invalidateShipmentsListCache();

  const liveSummary = pickSummaryShape(await fetchSummary(token, range));

  const errors = diffSummaries(dailySummary, liveSummary);
  if (errors.length) {
    logger.error('REGRESSION FAILED', { errors });
    process.exit(1);
  }

  logger.info('REGRESSION PASS: shipment summary daily vs live match', {
    total: dailySummary.total,
    unplannedTable: dailySummary.unplannedTable,
    range,
  });
  process.exit(0);
}

main().catch((err) => {
  logger.error('Regression script error', err);
  process.exit(1);
});
