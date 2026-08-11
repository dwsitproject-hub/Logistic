import type { PoolClient } from 'pg';
import logger from '../utils/logger';
import type { SapVesselIdentity } from '../utils/sapVesselFields';
import { hasCompleteSapVesselIdentity } from '../utils/sapVesselFields';
import { resolveMasterVessel } from './resolveMasterVessel.service';

/**
 * When SAP provides both vessel code and vessel name, ensure a canonical master_vessels row exists.
 * Alternative SAP codes for the same vessel are stored as aliases (no duplicate master rows).
 */
export async function ensureMasterVesselFromSap(
  identity: SapVesselIdentity,
  client?: PoolClient,
): Promise<void> {
  if (!hasCompleteSapVesselIdentity(identity)) return;

  try {
    await resolveMasterVessel(
      {
        vessel_code: identity.vessel_code,
        vessel_name: identity.vessel_name,
        vessel_owner: identity.vessel_owner,
        source: 'sap_import',
        updateAttributes: true,
        code_status: 'OFFICIAL',
      },
      client,
    );
  } catch (error) {
    logger.warn('ensureMasterVesselFromSap failed', {
      vesselCode: identity.vessel_code,
      vesselName: identity.vessel_name,
      error,
    });
  }
}
