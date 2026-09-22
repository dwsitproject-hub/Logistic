import logger from '../utils/logger';
import { isDhmEnabled } from './config';
import { postVesselInbound, putVesselInbound } from './inbound';
import { persistDhmReplica } from './replica';
import type { DhmInboundResult, KlipVesselForDhm } from './types';

export interface DhmPushAttachment {
  dhmConflict?: boolean;
  dhmStatus?: string;
  dhmCode?: string | null;
  dhmError?: string;
  dhmRecord?: unknown;
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

    if (result.ok) {
      await persistDhmReplica(localId, result.record, result.code);
      return { dhmStatus: result.status, dhmCode: result.code };
    }

    if (result.conflict) {
      await persistDhmReplica(localId, result.record, result.code);
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
    return { dhmError: 'DHM unavailable' };
  }
}
