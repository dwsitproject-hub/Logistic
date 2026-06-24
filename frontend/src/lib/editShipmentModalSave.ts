import api from '@/lib/api'
import { toApiDateOnly } from '@/lib/dateFormat'
import type { ShipmentAtaFields } from '@/lib/shipmentAtaFields'
import { buildAtaOverridePayload } from '@/lib/shipmentAtaFields'
import type { VesselPortsQuantityEdits, VesselPortsQuantityRow } from '@/components/shipments/VesselPortsQuantitiesTable'
import { sumVesselPortsQuantityEdits } from '@/components/shipments/VesselPortsQuantitiesTable'

function dateInputFromUnknown(v: unknown): string | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'string') return v
  return undefined
}

export function buildLoadingPortUpdatePayload(
  source: Record<string, unknown>,
  portId: string,
): Record<string, unknown> {
  const berthedLoading = toApiDateOnly(
    dateInputFromUnknown(source.eta_vessel_berthed_at_loading_port ?? source.eta_vessel_berthed),
  )
  return {
    id: portId,
    port_name: source.port_name,
    port_sequence: source.port_sequence ?? 1,
    quantity_at_loading_port: source.quantity_at_loading_port ?? 0,
    is_discharge_port: Boolean(source.is_discharge_port),
    quality_ffa: source.quality_ffa ?? null,
    quality_mi: source.quality_mi ?? null,
    quality_dobi: source.quality_dobi ?? null,
    quality_red: source.quality_red ?? null,
    quality_ds: source.quality_ds ?? null,
    quality_stone: source.quality_stone ?? null,
    eta_vessel_arrival: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_arrival)),
    ata_vessel_arrival: toApiDateOnly(dateInputFromUnknown(source.ata_vessel_arrival)),
    eta_vessel_berthed: berthedLoading,
    ata_vessel_berthed: toApiDateOnly(dateInputFromUnknown(source.ata_vessel_berthed)),
    eta_vessel_berthed_at_loading_port: berthedLoading,
    eta_loading_start: toApiDateOnly(dateInputFromUnknown(source.eta_loading_start)),
    ata_loading_start: toApiDateOnly(dateInputFromUnknown(source.ata_loading_start)),
    eta_loading_completed: toApiDateOnly(dateInputFromUnknown(source.eta_loading_completed)),
    ata_loading_completed: toApiDateOnly(dateInputFromUnknown(source.ata_loading_completed)),
    eta_vessel_sailed: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_sailed)),
    ata_vessel_sailed: toApiDateOnly(dateInputFromUnknown(source.ata_vessel_sailed)),
    eta_vessel_arrive_at_discharge_port: toApiDateOnly(
      dateInputFromUnknown(source.eta_vessel_arrive_at_discharge_port),
    ),
    eta_vessel_berthed_at_discharge_port: toApiDateOnly(
      dateInputFromUnknown(source.eta_vessel_berthed_at_discharge_port),
    ),
    eta_vessel_start_discharging: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_start_discharging)),
    eta_vessel_complete_discharge: toApiDateOnly(dateInputFromUnknown(source.eta_vessel_complete_discharge)),
  }
}

export type EditEtaFields = {
  etaVesselArrivalAtLoadingPort: string
  etaVesselBerthedAtLoadingPort: string
  etaVesselStartLoading: string
  etaVesselCompletedLoading: string
  etaVesselSailedFromLoadingPort: string
  etaVesselArriveAtDischargePort: string
  etaVesselBerthedAtDischargePort: string
  etaVesselStartDischarging: string
  etaVesselCompleteDischarge: string
}

export type LoadingPortRef = {
  id?: string
  port_name?: string
  port_sequence?: number
  is_discharge_port?: boolean
  quantity_at_loading_port?: number
  quality_ffa?: number | null
  quality_mi?: number | null
  quality_dobi?: number | null
  quality_red?: number | null
  quality_ds?: number | null
  quality_stone?: number | null
  eta_vessel_arrival?: string | null
  eta_vessel_berthed_at_loading_port?: string | null
  eta_loading_start?: string | null
  eta_loading_completed?: string | null
  eta_vessel_sailed?: string | null
}

export type SaveEditShipmentInput = {
  shipmentId: string
  vesselName: string
  originalVesselName: string
  sfalQty: number | null
  sfbdQty: number | null
  originalSfalQty: number | null
  originalSfbdQty: number | null
  loadingPort: string
  dischargePort: string
  activeEta: EditEtaFields
  qtyRows: VesselPortsQuantityRow[]
  qtyEdits: VesselPortsQuantityEdits
  originalDeliveredKg: number | null
  originalReceiveKg: number | null
  quantityUnlocked: boolean
  hasSldOrSddDoc: boolean
  loadingPorts: LoadingPortRef[]
  ataFields?: ShipmentAtaFields
  originalAtaFields?: ShipmentAtaFields
}

function quantityValuesEqual(a: unknown, b: unknown): boolean {
  const pa = a === null || a === undefined || a === '' ? null : Number(a)
  const pb = b === null || b === undefined || b === '' ? null : Number(b)
  if (pa === null && pb === null) return true
  if (pa === null || pb === null) return false
  return Math.abs(pa - pb) < 0.001
}

export async function saveEditShipmentChanges(input: SaveEditShipmentInput): Promise<void> {
  const sums = sumVesselPortsQuantityEdits(input.qtyRows, input.qtyEdits)
  const deliveryChanged = !quantityValuesEqual(sums.quantity_delivered, input.originalDeliveredKg)
  const receiveChanged = !quantityValuesEqual(sums.quantity_receive, input.originalReceiveKg)

  if ((deliveryChanged || receiveChanged) && !input.quantityUnlocked) {
    throw new Error('Please upload an SLD or SDD document before editing Delivered or Receive quantities.')
  }
  if ((deliveryChanged || receiveChanged) && !input.hasSldOrSddDoc) {
    throw new Error('An SLD or SDD document must be attached before saving quantity changes.')
  }

  const updateBody: Record<string, unknown> = {
    eta_arrival: toApiDateOnly(input.activeEta.etaVesselArrivalAtLoadingPort),
    eta_berthed: toApiDateOnly(input.activeEta.etaVesselBerthedAtLoadingPort),
    eta_loading_start: toApiDateOnly(input.activeEta.etaVesselStartLoading),
    eta_loading_complete: toApiDateOnly(input.activeEta.etaVesselCompletedLoading),
    eta_sailed: toApiDateOnly(input.activeEta.etaVesselSailedFromLoadingPort),
    eta_discharge_arrival: toApiDateOnly(input.activeEta.etaVesselArriveAtDischargePort),
    eta_discharge_berthed: toApiDateOnly(input.activeEta.etaVesselBerthedAtDischargePort),
    eta_discharge_start: toApiDateOnly(input.activeEta.etaVesselStartDischarging),
    eta_discharge_complete: toApiDateOnly(input.activeEta.etaVesselCompleteDischarge),
  }

  if (input.vesselName.trim() && input.vesselName.trim() !== input.originalVesselName.trim()) {
    updateBody.vessel_name = input.vesselName.trim()
  }
  if (sums.quantity_delivered !== null) updateBody.quantity_delivered = sums.quantity_delivered
  if (sums.quantity_receive !== null) updateBody.actual_vessel_qty_receive = sums.quantity_receive
  if (!quantityValuesEqual(input.sfalQty, input.originalSfalQty)) updateBody.sfal_qty = input.sfalQty
  if (!quantityValuesEqual(input.sfbdQty, input.originalSfbdQty)) updateBody.sfbd_qty = input.sfbdQty

  const pol = input.loadingPort.trim()
  if (pol && pol !== '0.00') updateBody.port_of_loading = pol
  const pod = input.dischargePort.trim()
  if (pod && pod !== '0.00') updateBody.port_of_discharge = pod

  if (Object.keys(updateBody).length > 0) {
    const res = await api.put(`/shipments/${input.shipmentId}`, updateBody)
    if (!res.data?.success) {
      throw new Error(res.data?.error?.message || 'Failed to update shipment')
    }
  }

  const portsRes = await api.get(`/shipments/${input.shipmentId}/loading-ports`)
  const ports: LoadingPortRef[] = portsRes.data?.data?.ports ?? input.loadingPorts

  const firstPort =
    ports.find((p) => !p.is_discharge_port && p.port_sequence === 1) ||
    ports.find((p) => !p.is_discharge_port)

  const info = {
    vessel_loading_port_1: input.loadingPort,
    vessel_discharge_port_1: input.dischargePort,
    actual_vessel_qty_receive: sums.quantity_receive,
    eta_vessel_arrival_at_loading_port: input.activeEta.etaVesselArrivalAtLoadingPort,
    eta_vessel_berthed_at_loading_port: input.activeEta.etaVesselBerthedAtLoadingPort,
    eta_vessel_start_loading: input.activeEta.etaVesselStartLoading,
    eta_vessel_completed_loading: input.activeEta.etaVesselCompletedLoading,
    eta_vessel_sailed_from_loading_port: input.activeEta.etaVesselSailedFromLoadingPort,
    eta_vessel_arrive_at_discharge_port: input.activeEta.etaVesselArriveAtDischargePort,
    eta_vessel_berthed_at_discharge_port: input.activeEta.etaVesselBerthedAtDischargePort,
    eta_vessel_start_discharging: input.activeEta.etaVesselStartDischarging,
    eta_vessel_complete_discharge: input.activeEta.etaVesselCompleteDischarge,
  }

  if (firstPort?.id) {
    const payload = buildLoadingPortUpdatePayload(
      {
        ...(firstPort as Record<string, unknown>),
        port_name: info.vessel_loading_port_1 || firstPort.port_name || 'Loading Port 1',
        port_sequence: firstPort.port_sequence ?? 1,
        quantity_at_loading_port: info.actual_vessel_qty_receive ?? firstPort.quantity_at_loading_port ?? 0,
        is_discharge_port: false,
        eta_vessel_arrival: info.eta_vessel_arrival_at_loading_port,
        eta_vessel_berthed_at_loading_port: info.eta_vessel_berthed_at_loading_port,
        eta_vessel_berthed: info.eta_vessel_berthed_at_loading_port,
        eta_loading_start: info.eta_vessel_start_loading,
        eta_loading_completed: info.eta_vessel_completed_loading,
        eta_vessel_sailed: info.eta_vessel_sailed_from_loading_port,
      },
      firstPort.id,
    )
    await api.put(`/shipments/${input.shipmentId}/loading-ports/${firstPort.id}`, payload)
  } else if (
    info.eta_vessel_arrival_at_loading_port ||
    info.eta_vessel_berthed_at_loading_port ||
    info.vessel_loading_port_1
  ) {
    const createPayload = buildLoadingPortUpdatePayload(
      {
        port_name: info.vessel_loading_port_1 || 'Loading Port 1',
        port_sequence: 1,
        quantity_at_loading_port: info.actual_vessel_qty_receive || 0,
        is_discharge_port: false,
        eta_vessel_arrival: info.eta_vessel_arrival_at_loading_port,
        eta_vessel_berthed_at_loading_port: info.eta_vessel_berthed_at_loading_port,
        eta_vessel_berthed: info.eta_vessel_berthed_at_loading_port,
        eta_loading_start: info.eta_vessel_start_loading,
        eta_loading_completed: info.eta_vessel_completed_loading,
        eta_vessel_sailed: info.eta_vessel_sailed_from_loading_port,
      },
      '',
    )
    delete createPayload.id
    await api.post(`/shipments/${input.shipmentId}/loading-ports`, createPayload)
  }

  const refreshed = await api.get(`/shipments/${input.shipmentId}/loading-ports`)
  const finalPorts: LoadingPortRef[] = refreshed.data?.data?.ports ?? ports
  const dischargePort =
    finalPorts.find((p) => p.is_discharge_port) || ports.find((p) => p.is_discharge_port)

  if (dischargePort?.id) {
    const dischargePayload = buildLoadingPortUpdatePayload(
      {
        ...(dischargePort as Record<string, unknown>),
        port_name: info.vessel_discharge_port_1 || dischargePort.port_name || 'Discharge Port',
        port_sequence: dischargePort.port_sequence ?? 999,
        is_discharge_port: true,
        eta_vessel_arrive_at_discharge_port: info.eta_vessel_arrive_at_discharge_port,
        eta_vessel_berthed_at_discharge_port: info.eta_vessel_berthed_at_discharge_port,
        eta_vessel_start_discharging: info.eta_vessel_start_discharging,
        eta_vessel_complete_discharge: info.eta_vessel_complete_discharge,
        eta_vessel_arrival: null,
        eta_vessel_berthed_at_loading_port: null,
        eta_loading_start: null,
        eta_loading_completed: null,
        eta_vessel_sailed: null,
      },
      dischargePort.id,
    )
    await api.put(`/shipments/${input.shipmentId}/loading-ports/${dischargePort.id}`, dischargePayload)
  }

  if (input.ataFields && input.originalAtaFields) {
    const ataPayload = buildAtaOverridePayload(input.ataFields, input.originalAtaFields)
    if (ataPayload) {
      const ataRes = await api.put(`/shipments/${input.shipmentId}/ata-override`, ataPayload)
      if (!ataRes.data?.success) {
        throw new Error(ataRes.data?.error?.message || 'Failed to save ATA override')
      }
    }
  }
}
