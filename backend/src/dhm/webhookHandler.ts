import logger from '../utils/logger';
import { applyDhmVesselRecord, markDhmWebhookDelivery } from './replica';
import { parseDhmWebhookPayload, verifyDhmSignature } from './webhook';
import type { DhmRecord } from './types';
import { query } from '../database/connection';

export async function handleDhmWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): Promise<{ accepted: boolean; duplicate?: boolean; error?: string }> {
  if (!verifyDhmSignature(rawBody, signatureHeader)) {
    return { accepted: false, error: 'Invalid signature' };
  }
  const payload = parseDhmWebhookPayload(rawBody);
  if (!payload) {
    return { accepted: false, error: 'Invalid payload' };
  }

  const firstSeen = await markDhmWebhookDelivery(payload.deliveryId);
  if (!firstSeen) {
    return { accepted: true, duplicate: true };
  }

  if (payload.entityType !== 'vessel') {
    return { accepted: true };
  }

  try {
    if (payload.event === 'record.deleted') {
      await query(
        `UPDATE master_vessels
         SET dhm_is_deleted = true, dhm_version = COALESCE($2, dhm_version), updated_at = CURRENT_TIMESTAMP
         WHERE dhm_id = $1::uuid`,
        [payload.recordId, payload.version ?? null],
      );
      return { accepted: true };
    }

    const record: DhmRecord = {
      id: payload.recordId,
      version: payload.version || 1,
      isDeleted: false,
      data: payload.data && typeof payload.data === 'object' ? payload.data : {},
      updatedAt: payload.occurredAt || '',
    };
    await applyDhmVesselRecord(record);
    return { accepted: true };
  } catch (error) {
    logger.error('DHM webhook apply failed', { deliveryId: payload.deliveryId, error });
    return { accepted: false, error: 'Apply failed' };
  }
}
