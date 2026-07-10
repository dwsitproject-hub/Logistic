import { ContractQtyMoveSnapshotService } from '../services/contractQtyMoveSnapshot.service';
import logger from '../utils/logger';

async function main(): Promise<void> {
  logger.info('Refreshing contract qty_move snapshot...');
  const rowCount = await ContractQtyMoveSnapshotService.refreshAll();
  logger.info('Contract qty_move snapshot refresh completed', { rowCount });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Contract qty_move snapshot refresh failed', err);
    process.exit(1);
  });
