import { Response } from 'express';
import { pushMasterCatalogToDhm, readDhmSyncMaster } from '../dhm/pushCatalog';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

export const syncMasterCatalogToDhm = async (req: AuthRequest, res: Response): Promise<void> => {
  const master = readDhmSyncMaster(req.body?.master);
  if (!master) {
    res.status(400).json({ success: false, error: { message: 'Unknown master' } });
    return;
  }
  const overwrite = req.body?.overwrite === true || String(req.body?.overwrite ?? '').toLowerCase() === 'true';
  try {
    const data = await pushMasterCatalogToDhm(master, overwrite);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Manual DHM master sync error:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to sync master to DHM' } });
  }
};
