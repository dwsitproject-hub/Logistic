import { Response } from 'express';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import {
  getShipmentAtaOverrideByShipmentId,
  mapOverrideRowToApi,
} from '../services/shipmentAtaOverride.service';
import { upsertShipmentAtaOverrideForStoGroup } from '../services/shipmentAtaStoFanOut.service';
import { invalidateShipmentsListCache } from '../services/shipmentList.service';
import {
  SHIPMENT_ATA_API_FIELDS,
  type ShipmentAtaOverridePayload,
} from '../utils/shipmentAtaOverrideFields';
import {
  sqlSapAtaArrivalDischarge,
  sqlSapAtaArrivalLoading,
  sqlSapAtaBerthedDischarge,
  sqlSapAtaBerthedLoading,
  sqlSapAtaCompleteDischarge,
  sqlSapAtaCompletedLoading,
  sqlSapAtaSailedLoading,
  sqlSapAtaStartDischarge,
  sqlSapAtaStartLoading,
  SHIPMENT_ATA_OVERRIDES_JOIN,
} from '../utils/shipmentAtaOverrideSql';

function parsePayload(body: unknown): ShipmentAtaOverridePayload {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const out: ShipmentAtaOverridePayload = {};
  for (const field of SHIPMENT_ATA_API_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, field)) {
      const raw = src[field];
      out[field] = raw == null || String(raw).trim() === '' ? null : String(raw).trim().slice(0, 10);
    }
  }
  return out;
}

export const getShipmentAtaOverride = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const exists = await query(`SELECT id FROM shipments WHERE id = $1::uuid LIMIT 1`, [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Shipment not found' } });
    }

    const row = await getShipmentAtaOverrideByShipmentId(id);
    const sapRes = await query(
      `SELECT
         ${sqlSapAtaArrivalLoading()} AS sap_ata_vessel_arrival_at_loading_port,
         ${sqlSapAtaBerthedLoading()} AS sap_ata_vessel_berthed_at_loading_port,
         ${sqlSapAtaStartLoading()} AS sap_ata_vessel_start_loading,
         ${sqlSapAtaCompletedLoading()} AS sap_ata_vessel_completed_loading,
         ${sqlSapAtaSailedLoading()} AS sap_ata_vessel_sailed_from_loading_port,
         ${sqlSapAtaArrivalDischarge()} AS sap_ata_vessel_arrive_at_discharge_port,
         ${sqlSapAtaBerthedDischarge()} AS sap_ata_vessel_berthed_at_discharge_port,
         ${sqlSapAtaStartDischarge()} AS sap_ata_vessel_start_discharging,
         ${sqlSapAtaCompleteDischarge()} AS sap_ata_vessel_complete_discharge
       FROM shipments s
       LEFT JOIN vessel_loading_ports vlp1
         ON vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND COALESCE(vlp1.is_discharge_port, false) = false
       LEFT JOIN vessel_loading_ports vlpd
         ON vlpd.shipment_id = s.id AND COALESCE(vlpd.is_discharge_port, false) = true
       ${SHIPMENT_ATA_OVERRIDES_JOIN}
       WHERE s.id = $1::uuid
       LIMIT 1`,
      [id],
    );

    return res.json({
      success: true,
      data: {
        override: mapOverrideRowToApi(row),
        sap_reference: sapRes.rows[0] ?? {},
      },
    });
  } catch (err) {
    logger.error('getShipmentAtaOverride error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load ATA override' } });
  }
};

export const updateShipmentAtaOverride = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const payload = parsePayload(req.body);

    const exists = await query(`SELECT id FROM shipments WHERE id = $1::uuid LIMIT 1`, [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Shipment not found' } });
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ success: false, error: { message: 'No ATA fields provided' } });
    }

    const row = await upsertShipmentAtaOverrideForStoGroup(id, payload, req.user?.id ?? null);
    invalidateShipmentsListCache();

    return res.json({
      success: true,
      message: 'ATA override saved',
      data: {
        override: mapOverrideRowToApi(row),
      },
    });
  } catch (err) {
    logger.error('updateShipmentAtaOverride error:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to save ATA override' } });
  }
};
