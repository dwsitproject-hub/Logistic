import type { PoolClient } from 'pg';
import { query } from '../database/connection';
import logger from '../utils/logger';
import type { SapVesselIdentity } from '../utils/sapVesselFields';
import { hasCompleteSapVesselIdentity } from '../utils/sapVesselFields';

type QueryFn = (text: string, params?: unknown[]) => Promise<unknown>;

/**
 * When SAP provides both vessel code and vessel name, ensure a master_vessels row exists.
 * Skips when either field is missing.
 */
export async function ensureMasterVesselFromSap(
  identity: SapVesselIdentity,
  client?: PoolClient,
): Promise<void> {
  if (!hasCompleteSapVesselIdentity(identity)) return;

  const run: QueryFn = client ? client.query.bind(client) : query;
  const vesselCode = identity.vessel_code!.trim();
  const vesselName = identity.vessel_name!.trim();
  const vesselOwner = identity.vessel_owner?.trim() || null;

  try {
    await run(
      `INSERT INTO master_vessels (
        vessel_code, vessel_name, vessel_owner
      ) VALUES ($1, $2, $3)
      ON CONFLICT (vessel_code) DO UPDATE SET
        vessel_name = COALESCE(NULLIF(TRIM(EXCLUDED.vessel_name), ''), master_vessels.vessel_name),
        vessel_owner = COALESCE(NULLIF(TRIM(EXCLUDED.vessel_owner), ''), master_vessels.vessel_owner),
        updated_at = CURRENT_TIMESTAMP`,
      [vesselCode, vesselName, vesselOwner],
    );
  } catch (error) {
    logger.warn('ensureMasterVesselFromSap failed', {
      vesselCode,
      vesselName,
      error,
    });
  }
}
