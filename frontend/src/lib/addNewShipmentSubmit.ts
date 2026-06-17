import api from '@/lib/api'
import type { AddNewShipmentSubmitPayload } from '@/components/shared/addNewShipmentTypes'

export async function submitAddNewShipmentPayload(payload: AddNewShipmentSubmitPayload): Promise<void> {
  if (payload.kind === 'update') {
    const response = await api.put(`/shipments/${payload.shipmentId}`, {
      eta_arrival: payload.eta_arrival,
      eta_berthed: payload.eta_berthed,
      eta_loading_start: payload.eta_loading_start,
      eta_loading_complete: payload.eta_loading_complete,
      eta_sailed: payload.eta_sailed,
      eta_discharge_arrival: payload.eta_discharge_arrival,
      eta_discharge_berthed: payload.eta_discharge_berthed,
      eta_discharge_start: payload.eta_discharge_start,
      eta_discharge_complete: payload.eta_discharge_complete,
    })
    if (!response.data?.success) {
      throw new Error(response.data?.error?.message || 'Failed to update shipment')
    }
    return
  }

  const response = await api.post('/shipments', payload)
  if (!response.data?.success) {
    throw new Error(response.data?.error?.message || 'Failed to create shipment')
  }
}
