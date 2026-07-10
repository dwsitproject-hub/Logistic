import { ContractStoAggSnapshotService } from '../services/contractStoAggSnapshot.service';
import logger from '../utils/logger';

async function main(): Promise<void> {
  logger.info('Refreshing contract sto_agg snapshot...');
  const rowCount = await ContractStoAggSnapshotService.refreshAll();
  logger.info('Contract sto_agg snapshot refresh completed', { rowCount });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Contract sto_agg snapshot refresh failed', err);
    process.exit(1);
  });
