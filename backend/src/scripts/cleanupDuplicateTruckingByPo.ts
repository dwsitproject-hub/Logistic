/**
 * Deduplicate active trucking_operations per PO (WB-complete keeper).
 *
 * Usage:
 *   cd backend
 *   npx ts-node src/scripts/cleanupDuplicateTruckingByPo.ts --po 1001031094
 *   npx ts-node src/scripts/cleanupDuplicateTruckingByPo.ts --po 1001031094 --apply
 *   npx ts-node src/scripts/cleanupDuplicateTruckingByPo.ts --all --apply
 */
import * as fs from 'fs';
import * as path from 'path';
import { getClient } from '../database/connection';
import {
  dedupeActiveTruckingOpsForPo,
  listDuplicateTruckingByPo,
} from '../services/truckingDedupe.service';
import { invalidateTruckingListCache } from '../services/truckingList.service';
import { PipelineDailySummaryService } from '../services/pipelineDailySummary.service';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const soft = args.includes('--soft');
  const poIdx = args.indexOf('--po');
  const poFilter =
    poIdx >= 0 && args[poIdx + 1] && !args[poIdx + 1].startsWith('--')
      ? String(args[poIdx + 1]).trim()
      : null;

  if (!all && !poFilter) {
    console.error('Usage: --po <PO> [--apply]  OR  --all [--apply]');
    process.exit(1);
  }

  const client = await getClient();
  let cancelledAny = false;
  try {
    const preview = await listDuplicateTruckingByPo(client, all ? null : poFilter);
    if (preview.length === 0) {
      console.log(
        JSON.stringify(
          {
            mode: apply ? 'apply' : 'dry-run',
            poFilter: all ? null : poFilter,
            message: 'No active duplicate trucking rows found for PO scope',
          },
          null,
          2,
        ),
      );
      return;
    }

    const keepers = preview.filter((r) => r.rn === 1);
    const losers = preview.filter((r) => r.rn > 1);
    const report = {
      mode: apply ? 'apply' : 'dry-run',
      poFilter: all ? null : poFilter,
      duplicatePoGroups: keepers.length,
      rowsToCancel: losers.length,
      keepers: keepers.map((k) => ({
        po_number: k.po_number,
        id: k.id,
        operation_id: k.operation_id,
        status: k.status,
        wb_dates: k.wb_dates,
        wb_qty_kg: k.wb_qty_kg,
      })),
      cancel: losers.map((d) => ({
        po_number: d.po_number,
        id: d.id,
        operation_id: d.operation_id,
        status: d.status,
        wb_dates: d.wb_dates,
        wb_qty_kg: d.wb_qty_kg,
      })),
    };
    console.log(JSON.stringify(report, null, 2));

    const dir = path.resolve(process.cwd(), '..', 'tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const auditFile = path.join(dir, `trucking-po-dedupe-audit-${stamp}.csv`);
    const header = 'role,po,op_id,operation_id,status,wb_dates,wb_qty_kg,action';
    const lines = [
      ...keepers.map(
        (k) =>
          `"keeper","${k.po_number}","${k.id}","${k.operation_id ?? ''}","${k.status ?? ''}","${k.wb_dates}","${k.wb_qty_kg}","${apply ? 'kept' : 'dry_run'}"`,
      ),
      ...losers.map(
        (d) =>
          `"loser","${d.po_number}","${d.id}","${d.operation_id ?? ''}","${d.status ?? ''}","${d.wb_dates}","${d.wb_qty_kg}","${apply ? 'cancel' : 'dry_run'}"`,
      ),
    ];
    fs.writeFileSync(auditFile, [header, ...lines].join('\n'), 'utf8');
    console.log(`Audit CSV: ${auditFile}`);

    if (!apply) {
      console.log(
        `\nDry-run only. Re-run with --apply to merge WB actuals and ${soft ? 'soft-dedupe' : 'cancel'} losers.`,
      );
      return;
    }

    const pos = [...new Set(keepers.map((k) => String(k.po_number ?? '').trim()).filter(Boolean))];
    await client.query('BEGIN');
    const results: Array<{
      po: string;
      keeperId: string | null;
      cancelledIds: string[];
      dedupedIds: string[];
    }> = [];
    for (const po of pos) {
      const r = await dedupeActiveTruckingOpsForPo(client, po, {
        skipPipelineRefresh: true,
        mode: soft ? 'soft_dedupe' : 'cancel',
        dedupedReason: soft ? 'manual_script_soft' : undefined,
      });
      results.push({
        po,
        keeperId: r.keeperId,
        cancelledIds: r.cancelledIds,
        dedupedIds: r.dedupedIds,
      });
      if (r.cancelledIds.length > 0 || r.dedupedIds.length > 0) cancelledAny = true;
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ applied: results }, null, 2));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  if (apply && cancelledAny) {
    invalidateTruckingListCache();
    console.log('Refreshing trucking pipeline summary (single pass)...');
    const rowCount = await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();
    console.log(JSON.stringify({ pipelineRefreshed: true, rowCount }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
