import api from '@/lib/api'
import { toApiDateOnly } from '@/lib/dateFormat'
import type { ShipmentAtaFields } from '@/lib/shipmentAtaFields'
import { buildAtaOverridePayload } from '@/lib/shipmentAtaFields'
import type { VesselPortsQuantityEdits, VesselPortsQuantityRow } from '@/lib/vesselPortsQuantityEdits'
import {
  hasVesselPortsQuantityUserEdits,
  quantityKgValuesEqual,
} from '@/lib/vesselPortsQuantityEdits'
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

export type LoadingEtaFields = {
  etaVesselArrivalAtLoadingPort: string
  etaVesselBerthedAtLoadingPort: string
  etaVesselStartLoading: string
  etaVesselCompletedLoading: string
  etaVesselSailedFromLoadingPort: string
}

export type DischargeEtaFields = {
  etaVesselArriveAtDischargePort: string
  etaVesselBerthedAtDischargePort: string
  etaVesselStartDischarging: string
  etaVesselCompleteDischarge: string
}

export type EditEtaFields = LoadingEtaFields & DischargeEtaFields

export type LoadingPortEtaSave = {
  portId?: string
  portSequence: number
  portName: string
  fields: LoadingEtaFields
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
  ata_vessel_arrival?: string | null
  ata_vessel_berthed?: string | null
  ata_loading_start?: string | null
  ata_loading_completed?: string | null
  ata_vessel_sailed?: string | null
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
  /** When true, `loadingPortEtas` holds per-port loading ETAs; discharge ETAs are shared via `dischargeEta`. */
  isMultiPortLoading?: boolean
  loadingPortEtas?: LoadingPortEtaSave[]
  dischargeEta?: DischargeEtaFields
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
  return quantityKgValuesEqual(a, b)
}

function mergeActiveEtaFromMultiPort(
  loadingPortEtas: LoadingPortEtaSave[],
  dischargeEta: DischargeEtaFields,
): EditEtaFields {
  const first =
    loadingPortEtas.find((p) => p.portSequence === 1) ??
    loadingPortEtas.slice().sort((a, b) => a.portSequence - b.portSequence)[0]
  return {
    ...(first?.fields ?? {
      etaVesselArrivalAtLoadingPort: '',
      etaVesselBerthedAtLoadingPort: '',
      etaVesselStartLoading: '',
      etaVesselCompletedLoading: '',
      etaVesselSailedFromLoadingPort: '',
    }),
    ...dischargeEta,
  }
}

export async function saveShipmentEditRemark(shipmentId: string, text: string): Promise<void> {
  const remark = text.trim()
  if (!remark) {
    throw new Error('Remark is required when editing ETA or quantities.')
  }
  const res = await api.post(`/shipments/${shipmentId}/remarks`, {
    text: remark,
    category: 'EDIT_SHIPMENT',
  })
  if (!res.data?.success) {
    throw new Error(res.data?.error?.message || 'Failed to save remark')
  }
}

export async function saveEditShipmentChanges(input: SaveEditShipmentInput): Promise<void> {
  const sums = sumVesselPortsQuantityEdits(input.qtyRows, input.qtyEdits)
  const qtyUserEdited = hasVesselPortsQuantityUserEdits(input.qtyRows, input.qtyEdits)

  if (qtyUserEdited && !input.quantityUnlocked) {
    throw new Error('Please upload an SLD or SDD document before editing Delivered or Receive quantities.')
  }
  if (qtyUserEdited && !input.hasSldOrSddDoc) {
    throw new Error('An SLD or SDD document must be attached before saving quantity changes.')
  }

  const effectiveEta =
    input.isMultiPortLoading && input.loadingPortEtas?.length && input.dischargeEta
      ? mergeActiveEtaFromMultiPort(input.loadingPortEtas, input.dischargeEta)
      : input.activeEta

  const updateBody: Record<string, unknown> = {
    eta_arrival: toApiDateOnly(effectiveEta.etaVesselArrivalAtLoadingPort),
    eta_berthed: toApiDateOnly(effectiveEta.etaVesselBerthedAtLoadingPort),
    eta_loading_start: toApiDateOnly(effectiveEta.etaVesselStartLoading),
    eta_loading_complete: toApiDateOnly(effectiveEta.etaVesselCompletedLoading),
    eta_sailed: toApiDateOnly(effectiveEta.etaVesselSailedFromLoadingPort),
    eta_discharge_arrival: toApiDateOnly(effectiveEta.etaVesselArriveAtDischargePort),
    eta_discharge_berthed: toApiDateOnly(effectiveEta.etaVesselBerthedAtDischargePort),
    eta_discharge_start: toApiDateOnly(effectiveEta.etaVesselStartDischarging),
    eta_discharge_complete: toApiDateOnly(effectiveEta.etaVesselCompleteDischarge),
  }

  if (input.vesselName.trim() && input.vesselName.trim() !== input.originalVesselName.trim()) {
    updateBody.vessel_name = input.vesselName.trim()
  }
  if (qtyUserEdited) {
    if (sums.quantity_delivered !== null) updateBody.quantity_delivered = sums.quantity_delivered
    if (sums.quantity_receive !== null) updateBody.actual_vessel_qty_receive = sums.quantity_receive
  }
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

  const dischargeEta = input.dischargeEta ?? {
    etaVesselArriveAtDischargePort: effectiveEta.etaVesselArriveAtDischargePort,
    etaVesselBerthedAtDischargePort: effectiveEta.etaVesselBerthedAtDischargePort,
    etaVesselStartDischarging: effectiveEta.etaVesselStartDischarging,
    etaVesselCompleteDischarge: effectiveEta.etaVesselCompleteDischarge,
  }

  const loadingPortSaves: LoadingPortEtaSave[] =
    input.isMultiPortLoading && input.loadingPortEtas?.length
      ? input.loadingPortEtas
      : [
          {
            portSequence: 1,
            portName: input.loadingPort,
            fields: {
              etaVesselArrivalAtLoadingPort: effectiveEta.etaVesselArrivalAtLoadingPort,
              etaVesselBerthedAtLoadingPort: effectiveEta.etaVesselBerthedAtLoadingPort,
              etaVesselStartLoading: effectiveEta.etaVesselStartLoading,
              etaVesselCompletedLoading: effectiveEta.etaVesselCompletedLoading,
              etaVesselSailedFromLoadingPort: effectiveEta.etaVesselSailedFromLoadingPort,
            },
          },
        ]

  const receiveQty = qtyUserEdited ? sums.quantity_receive : input.originalReceiveKg

  for (const portSave of loadingPortSaves) {
    const existing =
      (portSave.portId ? ports.find((p) => p.id === portSave.portId) : undefined) ??
      ports.find((p) => !p.is_discharge_port && p.port_sequence === portSave.portSequence) ??
      ports.find((p) => !p.is_discharge_port && p.port_name === portSave.portName)

    const portName = portSave.portName || existing?.port_name || `Loading Port ${portSave.portSequence}`
    const quantity =
      portSave.portSequence === 1
        ? receiveQty ?? existing?.quantity_at_loading_port ?? 0
        : existing?.quantity_at_loading_port ?? 0

    const portSource = {
      ...(existing as Record<string, unknown> | undefined),
      port_name: portName,
      port_sequence: portSave.portSequence,
      quantity_at_loading_port: quantity,
      is_discharge_port: false,
      eta_vessel_arrival: portSave.fields.etaVesselArrivalAtLoadingPort,
      eta_vessel_berthed_at_loading_port: portSave.fields.etaVesselBerthedAtLoadingPort,
      eta_vessel_berthed: portSave.fields.etaVesselBerthedAtLoadingPort,
      eta_loading_start: portSave.fields.etaVesselStartLoading,
      eta_loading_completed: portSave.fields.etaVesselCompletedLoading,
      eta_vessel_sailed: portSave.fields.etaVesselSailedFromLoadingPort,
    }

    if (existing?.id) {
      const payload = buildLoadingPortUpdatePayload(portSource, existing.id)
      await api.put(`/shipments/${input.shipmentId}/loading-ports/${existing.id}`, payload)
    } else if (
      portSave.fields.etaVesselArrivalAtLoadingPort ||
      portSave.fields.etaVesselBerthedAtLoadingPort ||
      portName
    ) {
      const createPayload = buildLoadingPortUpdatePayload(portSource, '')
      delete createPayload.id
      await api.post(`/shipments/${input.shipmentId}/loading-ports`, createPayload)
    }
  }

  const refreshed = await api.get(`/shipments/${input.shipmentId}/loading-ports`)
  const finalPorts: LoadingPortRef[] = refreshed.data?.data?.ports ?? ports
  const dischargePort =
    finalPorts.find((p) => p.is_discharge_port) || ports.find((p) => p.is_discharge_port)

  if (dischargePort?.id) {
    const dischargePayload = buildLoadingPortUpdatePayload(
      {
        ...(dischargePort as Record<string, unknown>),
        port_name: input.dischargePort || dischargePort.port_name || 'Discharge Port',
        port_sequence: dischargePort.port_sequence ?? 999,
        is_discharge_port: true,
        eta_vessel_arrive_at_discharge_port: dischargeEta.etaVesselArriveAtDischargePort,
        eta_vessel_berthed_at_discharge_port: dischargeEta.etaVesselBerthedAtDischargePort,
        eta_vessel_start_discharging: dischargeEta.etaVesselStartDischarging,
        eta_vessel_complete_discharge: dischargeEta.etaVesselCompleteDischarge,
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
