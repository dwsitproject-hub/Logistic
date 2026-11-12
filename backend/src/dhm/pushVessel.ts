import logger from '../utils/logger';
import { query } from '../database/connection';
import { dhmUnavailableError } from './unavailable';
import { isDhmEnabled } from './config';
import { postVesselInbound, putVesselInbound } from './inbound';
import { persistDhmReplica } from './replica';
import type { DhmInboundResult, DhmRecord, KlipVesselForDhm } from './types';

export interface DhmPushAttachment {
  dhmConflict?: boolean;
  dhmStatus?: string;
  dhmCode?: string | null;
  dhmError?: string;
  dhmRecord?: unknown;
}

/**
 * Store DHM's record on this vessel. DHM decides what counts as "the same vessel" by its own rules (47 numbered barges of one fleet, "BG. MAKMUR ABADI IV", "... VI", "... X" with their own SAP
 * codes, were answered with the record of "BG. MAKMUR ABADI"), and one DHM record can be linked to only ONE KLIP vessel (uq_master_vessels_dhm_id). The link then fails; that used to surface
 * as the bare words "DHM unavailable" and be retried 11 times. It is a CONFLICT instead: named, never retried, and never overwritten (an overwrite would put this barge's data on the other
 * vessel's DHM record). Returns null when linked.
 */
async function linkDhmRecord(localId: string, record: DhmRecord, code: string | null | undefined, status?: string): Promise<DhmPushAttachment | null> {
  try {
    await persistDhmReplica(localId, record, code);
    return null;
  } catch (error) {
    if ((error as { code?: string })?.code !== '23505') throw error;
    const holder = await query(
      `SELECT vessel_name, dhm_code FROM master_vessels WHERE dhm_id = $1::uuid AND id <> $2::uuid LIMIT 1`,
      [record.id, localId],
    );
    const name = String(holder.rows[0]?.vessel_name ?? '').trim() || 'another KLIP vessel';
    const dhmCode = String(code || holder.rows[0]?.dhm_code || '').trim() || null;
    const updated = status === 'updated' ? " DHM also updated that record with this vessel's data." : '';
    return {
      dhmConflict: true,
      dhmStatus: 'duplicate',
      dhmCode,
      dhmRecord: record,
      dhmError: `Waiting for DHM approval: DHM matched this to "${name}"${dhmCode ? ` (${dhmCode})` : ''}, which is already linked to another KLIP vessel. If it is a different ship, a DHM user approves it as a new vessel.${updated}`,
    };
  }
}

export async function pushMasterVesselToDhm(
  localId: string,
  row: KlipVesselForDhm & { dhm_code?: string | null },
  options?: { overwrite?: boolean },
): Promise<DhmPushAttachment> {
  if (!isDhmEnabled()) return {};

  try {
    const existingCode = String(row.dhm_code || '').trim();
    let result: DhmInboundResult = existingCode
      ? await putVesselInbound(existingCode, row)
      : await postVesselInbound(row);

    // Inbound PUT 404 means that stored code is gone. Create it again and let DHM assign a new code.
    if (!result.ok && !result.conflict && result.httpStatus === 404 && existingCode) {
      result = await postVesselInbound(row);
    }

    if (result.ok) {
      const duplicate = await linkDhmRecord(localId, result.record, result.code, result.status);
      if (duplicate) return duplicate;
      return { dhmStatus: result.status, dhmCode: result.code };
    }

    if (result.conflict) {
      const duplicate = await linkDhmRecord(localId, result.record, result.code);
      if (duplicate) return duplicate;
      const code = result.code || String(result.record.data?.code || '').trim();
      if (options?.overwrite && code) {
        const updated = await putVesselInbound(code, row);
        if (updated.ok) {
          await persistDhmReplica(localId, updated.record, updated.code);
          return { dhmStatus: updated.status, dhmCode: updated.code };
        }
        return {
          dhmConflict: true,
          dhmCode: code,
          dhmRecord: result.record,
          dhmError: !updated.ok && !updated.conflict ? updated.error : 'DHM overwrite failed',
        };
      }
      return {
        dhmConflict: true,
        dhmStatus: 'duplicate',
        dhmCode: code || null,
        dhmRecord: result.record,
      };
    }

    logger.warn('DHM inbound rejected', { localId, error: result.error, status: result.httpStatus });
    return { dhmError: result.error };
  } catch (error) {
    logger.warn('DHM inbound unavailable; local vessel saved', { localId, error });
    return { dhmError: dhmUnavailableError(error) };
  }
}
