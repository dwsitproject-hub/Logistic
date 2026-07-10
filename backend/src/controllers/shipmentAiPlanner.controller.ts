import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import {
  AI_KLIP_AGENT,
  resolveAnthropicApiKeyName,
  truncateActivityText,
} from '../constants/aiKlipAgent';
import { logAiKlipAgentActivity } from '../services/aiKlipAgentActivityLog.service';
import {
  suggestEtaForShipment,
  suggestVesselForShipment,
} from '../services/shipmentAiPlanner.service';

export const suggestShipmentVessel = async (req: AuthRequest, res: Response) => {
  const supplier_id = String(req.body?.supplier_id ?? '');
  const buyer_id = String(req.body?.buyer_id ?? '');
  const product_id = String(req.body?.product_id ?? '');
  const incoterm = String(req.body?.incoterm ?? '');

  try {
    const result = await suggestVesselForShipment({
      supplier_id,
      buyer_id,
      product_id,
      incoterm,
    });

    void logAiKlipAgentActivity({
      agentName: AI_KLIP_AGENT.SHIPMENT_PLANNER,
      apiKeyName: resolveAnthropicApiKeyName(),
      userId: req.user?.id,
      status: 'success',
      activity: `Suggested vessel "${result.suggested_vessel_name}" (${result.source}) for ${supplier_id} / ${buyer_id} / ${product_id} / ${incoterm || '—'}.`,
      metadata: {
        action: 'suggest_vessel',
        supplier_id,
        buyer_id,
        product_id,
        incoterm,
        result,
      },
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to suggest vessel';
    logger.error('suggestShipmentVessel error', error);
    void logAiKlipAgentActivity({
      agentName: AI_KLIP_AGENT.SHIPMENT_PLANNER,
      apiKeyName: resolveAnthropicApiKeyName(),
      userId: req.user?.id,
      status: 'error',
      activity: `Vessel suggestion failed for ${supplier_id} / ${buyer_id} / ${product_id} / ${incoterm || '—'}: ${truncateActivityText(message, 300)}`,
      metadata: { action: 'suggest_vessel', supplier_id, buyer_id, product_id, incoterm, error: message },
    });
    const status = message.includes('required') ? 400 : 502;
    return res.status(status).json({
      success: false,
      error: { message },
    });
  }
};

export const suggestShipmentEta = async (req: AuthRequest, res: Response) => {
  const vessel_name = String(req.body?.vessel_name ?? '');
  const loading_port = String(req.body?.loading_port ?? '');
  const discharge_port = String(req.body?.discharge_port ?? '');
  const loading_date = String(req.body?.loading_date ?? '');

  try {
    const result = await suggestEtaForShipment({
      vessel_name,
      loading_port,
      discharge_port,
      loading_date,
    });

    void logAiKlipAgentActivity({
      agentName: AI_KLIP_AGENT.SHIPMENT_PLANNER,
      apiKeyName: resolveAnthropicApiKeyName(),
      userId: req.user?.id,
      status: 'success',
      activity: `Suggested ETA schedule (~${result.avg_transit_days} days, ${result.source}) for "${vessel_name}" ${loading_port} → ${discharge_port}.`,
      metadata: {
        action: 'suggest_eta',
        vessel_name,
        loading_port,
        discharge_port,
        loading_date,
        result,
      },
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to suggest ETA';
    logger.error('suggestShipmentEta error', error);
    void logAiKlipAgentActivity({
      agentName: AI_KLIP_AGENT.SHIPMENT_PLANNER,
      apiKeyName: resolveAnthropicApiKeyName(),
      userId: req.user?.id,
      status: 'error',
      activity: `ETA suggestion failed for "${vessel_name}" ${loading_port} → ${discharge_port}: ${truncateActivityText(message, 300)}`,
      metadata: {
        action: 'suggest_eta',
        vessel_name,
        loading_port,
        discharge_port,
        loading_date,
        error: message,
      },
    });
    const status =
      message.includes('required') || message.includes('loading_date') ? 400 : 502;
    return res.status(status).json({
      success: false,
      error: { message },
    });
  }
};
