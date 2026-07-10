import { ContractLatestSpdSnapshotService } from '../services/contractLatestSpdSnapshot.service';
import logger from '../utils/logger';

async function main(): Promise<void> {
  logger.info('Refreshing contract latest_spd snapshot...');
  const rowCount = await ContractLatestSpdSnapshotService.refreshAll();
  logger.info('Contract latest_spd snapshot refresh completed', { rowCount });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Contract latest_spd snapshot refresh failed', err);
    process.exit(1);
  });
