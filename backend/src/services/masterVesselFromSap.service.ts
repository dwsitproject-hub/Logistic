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

  // This is best-effort: a failure here must never take down the caller's row-level transaction.
  // When running inside one (client provided), wrap it in its own SAVEPOINT so a failure - most
  // commonly a deadlock, see below - rolls back to a clean point instead of leaving the whole
  // transaction "aborted" for every subsequent query the caller issues. Previously this catch
  // swallowed the error with no savepoint recovery, so the NEXT query on the same row (e.g.
  // finalizeSapShipmentAfterUpsert) immediately failed with a generic "current transaction is
  // aborted", which importRowError.ts then mislabeled as "skipped because an earlier row in this
  // batch failed" - hiding that this row's own vessel upsert was the actual cause.
  const savepoint = client ? `sp_vessel_${Math.random().toString(36).slice(2, 10)}` : null;
  try {
    if (client && savepoint) {
      await client.query(`SAVEPOINT ${savepoint}`);
      // Serialize concurrent writers of the same vessel (parallel import chunks, or two imports
      // running at once - nothing currently prevents that) so they queue instead of deadlocking
      // inside resolveMasterVessel's multi-statement upsert across master_vessels and
      // master_vessel_code_aliases. Mirrors the po:/contract: advisory locks already taken in
      // sapDataDistribution.service.ts distributeData for the same reason.
      const lockKey = String(identity.vessel_code || identity.vessel_name || '').trim().toUpperCase();
      if (lockKey) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [`vessel:${lockKey}`]);
      }
    }

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

    if (client && savepoint) {
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  } catch (error) {
    if (client && savepoint) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (spErr) {
        logger.error('ensureMasterVesselFromSap: failed to recover savepoint after error', {
          vesselCode: identity.vessel_code,
          vesselName: identity.vessel_name,
          spErr,
        });
      }
    }
    logger.warn('ensureMasterVesselFromSap failed', {
      vesselCode: identity.vessel_code,
      vesselName: identity.vessel_name,
      error,
    });
  }
}
