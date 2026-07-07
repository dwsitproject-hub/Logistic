import { PipelineDailySummaryService } from '../services/pipelineDailySummary.service';
import logger from '../utils/logger';

async function main(): Promise<void> {
  logger.info('Refreshing pipeline daily summaries (trucking + shipment)...');
  await PipelineDailySummaryService.refreshAll();
  logger.info('Pipeline daily summary refresh completed');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Pipeline daily summary refresh failed', err);
    process.exit(1);
  });
