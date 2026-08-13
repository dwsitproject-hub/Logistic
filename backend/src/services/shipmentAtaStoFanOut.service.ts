import { query } from '../database/connection';
import logger from '../utils/logger';
import { resolveStoGroupShipmentIds } from '../utils/shipmentStoGroupMembersSql';
import type { ShipmentAtaOverridePayload } from '../utils/shipmentAtaOverrideFields';
import {
  upsertShipmentAtaOverride,
  type ShipmentAtaOverrideRow,
} from './shipmentAtaOverride.service';

export type VesselLoadingPortAtaFields = {
  ata_vessel_arrival: string | null;
  ata_vessel_berthed: string | null;
  ata_loading_start: string | null;
  ata_loading_completed: string | null;
  ata_vessel_sailed: string | null;
};

/**
 * KLIP ATA on one STO voyage applies to every SEA shipment PO in the grouping
 * (`shipments` rows only — trucking operations are out of scope).
 */
export async function upsertShipmentAtaOverrideForStoGroup(
  anchorShipmentId: string,
  payload: ShipmentAtaOverridePayload,
  userId?: string | null,
): Promise<ShipmentAtaOverrideRow | null> {
  const memberIds = await resolveStoGroupShipmentIds(anchorShipmentId);
  const ids = memberIds.length > 0 ? memberIds : [anchorShipmentId];
  let anchorRow: ShipmentAtaOverrideRow | null = null;

  for (const memberId of ids) {
    const row = await upsertShipmentAtaOverride(query, memberId, payload, userId);
    if (memberId === anchorShipmentId) {
      anchorRow = row;
    }
  }

  if (ids.length > 1) {
    logger.info('Fanned ATA override out to STO group shipment POs', {
      anchorShipmentId,
      memberCount: ids.length,
    });
  }

  return anchorRow;
}

/**
 * Copy loading/discharge ATA from the port the user saved onto matching ports
 * on sibling shipment POs (same sequence + discharge flag). Inserts a port row
 * when the sibling has none.
 */
export async function fanOutVesselLoadingPortAtaToStoGroup(opts: {
  anchorShipmentId: string;
  sourcePortId: string;
  portSequence: number;
  isDischargePort: boolean;
  portName: string;
  ata: VesselLoadingPortAtaFields;
}): Promise<number> {
  const memberIds = await resolveStoGroupShipmentIds(opts.anchorShipmentId);
  const siblings = memberIds.filter((id) => id !== opts.anchorShipmentId);
  if (siblings.length === 0) return 0;

  let touched = 0;
  for (const siblingId of siblings) {
    const updated = await query(
      `UPDATE vessel_loading_ports
       SET ata_vessel_arrival = $3::timestamp,
           ata_vessel_berthed = $4::timestamp,
           ata_loading_start = $5::timestamp,
           ata_loading_completed = $6::timestamp,
           ata_vessel_sailed = $7::timestamp,
           updated_at = CURRENT_TIMESTAMP
       WHERE shipment_id = $1::uuid
         AND port_sequence = $2
         AND COALESCE(is_discharge_port, false) = $8
         AND id <> $9::uuid
       RETURNING id`,
      [
        siblingId,
        opts.portSequence,
        opts.ata.ata_vessel_arrival,
        opts.ata.ata_vessel_berthed,
        opts.ata.ata_loading_start,
        opts.ata.ata_loading_completed,
        opts.ata.ata_vessel_sailed,
        opts.isDischargePort,
        opts.sourcePortId,
      ],
    );

    if (updated.rows.length > 0) {
      touched += updated.rows.length;
      continue;
    }

    await query(
      `INSERT INTO vessel_loading_ports (
         shipment_id, port_name, port_sequence, is_discharge_port,
         ata_vessel_arrival, ata_vessel_berthed, ata_loading_start,
         ata_loading_completed, ata_vessel_sailed
       ) VALUES (
         $1::uuid, $2, $3, $4,
         $5::timestamp, $6::timestamp, $7::timestamp, $8::timestamp, $9::timestamp
       )`,
      [
        siblingId,
        opts.portName,
        opts.portSequence,
        opts.isDischargePort,
        opts.ata.ata_vessel_arrival,
        opts.ata.ata_vessel_berthed,
        opts.ata.ata_loading_start,
        opts.ata.ata_loading_completed,
        opts.ata.ata_vessel_sailed,
      ],
    );
    touched += 1;
  }

  if (touched > 0) {
    logger.info('Fanned loading-port ATA out to STO group shipment POs', {
      anchorShipmentId: opts.anchorShipmentId,
      sourcePortId: opts.sourcePortId,
      siblingCount: siblings.length,
      portsTouched: touched,
    });
  }

  return touched;
}
