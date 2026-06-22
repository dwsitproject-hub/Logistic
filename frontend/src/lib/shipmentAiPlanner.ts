import api from '@/lib/api';
import axios from 'axios';

function extractApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const msg = error.response?.data?.error?.message;
    if (typeof msg === 'string' && msg.trim()) return msg;
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export type VesselSuggestPayload = {
  supplier_id: string;
  buyer_id: string;
  product_id: string;
  incoterm: string;
};

export type VesselSuggestResponse = {
  suggested_vessel_name: string;
  suggested_charter_type: string | null;
  suggested_discharge_port: string | null;
  suggested_loading_port: string | null;
  source: 'SAP_HISTORICAL' | 'CLAUDE_AI';
  cached: boolean;
};

export type EtaSuggestPayload = {
  vessel_name: string;
  loading_port: string;
  discharge_port: string;
  loading_date: string;
};

export type EtaMilestones = {
  etaVesselArrivalAtLoadingPort: string;
  etaVesselBerthedAtLoadingPort: string;
  etaVesselStartLoading: string;
  etaVesselCompletedLoading: string;
  etaVesselSailedFromLoadingPort: string;
  etaVesselArriveAtDischargePort: string;
  etaVesselBerthedAtDischargePort: string;
  etaVesselStartDischarging: string;
  etaVesselCompleteDischarge: string;
};

export type EtaSuggestResponse = {
  avg_transit_days: number;
  source: 'SAP_HISTORICAL' | 'CLAUDE_AI';
  cached: boolean;
  milestones: EtaMilestones;
};

export async function suggestShipmentVessel(
  payload: VesselSuggestPayload,
): Promise<VesselSuggestResponse> {
  try {
    const response = await api.post('/shipments/suggest-vessel', payload);
    if (!response.data?.success) {
      throw new Error(response.data?.error?.message || 'Failed to get vessel suggestion');
    }
    return response.data.data as VesselSuggestResponse;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, 'Failed to get vessel suggestion'));
  }
}

export async function suggestShipmentEta(payload: EtaSuggestPayload): Promise<EtaSuggestResponse> {
  try {
    const response = await api.post('/shipments/suggest-eta', payload);
    if (!response.data?.success) {
      throw new Error(response.data?.error?.message || 'Failed to get ETA suggestion');
    }
    return response.data.data as EtaSuggestResponse;
  } catch (error) {
    throw new Error(extractApiErrorMessage(error, 'Failed to get ETA suggestion'));
  }
}
