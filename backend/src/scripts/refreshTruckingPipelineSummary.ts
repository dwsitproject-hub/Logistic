/**
 * One-shot: refresh trucking pipeline daily summary + stage snapshot after status changes.
 *   node dist/scripts/refreshTruckingPipelineSummary.js
 */
import { PipelineDailySummaryService } from '../services/pipelineDailySummary.service';
import { invalidateTruckingListCache } from '../services/truckingList.service';

async function main() {
  invalidateTruckingListCache();
  const n = await PipelineDailySummaryService.refreshTruckingPipelineDailySummary();
  console.log(JSON.stringify({ refreshed: true, rowCount: n }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
