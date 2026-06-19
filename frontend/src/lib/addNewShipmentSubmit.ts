import api from '@/lib/api'
import type { AddNewShipmentSubmitPayload } from '@/components/shared/addNewShipmentTypes'

export async function submitAddNewShipmentPayload(payload: AddNewShipmentSubmitPayload): Promise<void> {
  if (payload.kind === 'update') {
    const body: Record<string, unknown> = {
      eta_arrival: payload.eta_arrival,
      eta_berthed: payload.eta_berthed,
      eta_loading_start: payload.eta_loading_start,
      eta_loading_complete: payload.eta_loading_complete,
      eta_sailed: payload.eta_sailed,
      eta_discharge_arrival: payload.eta_discharge_arrival,
      eta_discharge_berthed: payload.eta_discharge_berthed,
      eta_discharge_start: payload.eta_discharge_start,
      eta_discharge_complete: payload.eta_discharge_complete,
    }
    if (payload.vessel_name !== undefined) body.vessel_name = payload.vessel_name
    if (payload.quantity_delivered !== undefined) body.quantity_delivered = payload.quantity_delivered
    if (payload.actual_vessel_qty_receive !== undefined) {
      body.actual_vessel_qty_receive = payload.actual_vessel_qty_receive
    }
    if (payload.sfal_qty !== undefined) body.sfal_qty = payload.sfal_qty
    if (payload.sfbd_qty !== undefined) body.sfbd_qty = payload.sfbd_qty

    const response = await api.put(`/shipments/${payload.shipmentId}`, body)
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
