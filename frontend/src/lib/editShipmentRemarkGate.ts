import type { DischargeEtaFields, EditEtaFields, LoadingAtaFields, LoadingEtaFields } from '@/lib/editShipmentModalSave'
import {
  buildAtaOverridePayload,
  emptyAtaFields,
  type ShipmentAtaApiField,
  type ShipmentAtaFields,
} from '@/lib/shipmentAtaFields'
import {
  DISCHARGE_QUALITY_PORT_KEY,
  shipmentQualityFieldsEqual,
  type ShipmentQualityFields,
} from '@/lib/shipmentQualityFields'

const LOADING_ETA_KEYS: (keyof LoadingEtaFields)[] = [
  'etaVesselArrivalAtLoadingPort',
  'etaVesselBerthedAtLoadingPort',
  'etaVesselStartLoading',
  'etaVesselCompletedLoading',
  'etaVesselSailedFromLoadingPort',
]

const DISCHARGE_ETA_KEYS: (keyof DischargeEtaFields)[] = [
  'etaVesselArriveAtDischargePort',
  'etaVesselBerthedAtDischargePort',
  'etaVesselStartDischarging',
  'etaVesselCompleteDischarge',
]

const ALL_ETA_KEYS: (keyof EditEtaFields)[] = [...LOADING_ETA_KEYS, ...DISCHARGE_ETA_KEYS]

export type ShipmentEtaBlockSnapshot = {
  portSequence: number
  status: 'active' | 'historical'
  isDraft?: boolean
  fields: EditEtaFields
}

export type ShipmentEtaBaseline = {
  isMultiPortLoading: boolean
  dischargeEta: DischargeEtaFields
  singlePortActiveEta: EditEtaFields | null
  loadingPorts: Array<{ portSequence: number; fields: LoadingEtaFields }>
}

function normalizeEtaDate(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).trim().slice(0, 10)
}

function etaDatesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeEtaDate(a) === normalizeEtaDate(b)
}

function pickLoadingFields(fields: EditEtaFields): LoadingEtaFields {
  return {
    etaVesselArrivalAtLoadingPort: fields.etaVesselArrivalAtLoadingPort,
    etaVesselBerthedAtLoadingPort: fields.etaVesselBerthedAtLoadingPort,
    etaVesselStartLoading: fields.etaVesselStartLoading,
    etaVesselCompletedLoading: fields.etaVesselCompletedLoading,
    etaVesselSailedFromLoadingPort: fields.etaVesselSailedFromLoadingPort,
  }
}

export function buildShipmentEtaBaseline(input: {
  isMultiPortLoading: boolean
  dischargeEta: DischargeEtaFields
  etaBlocks: ShipmentEtaBlockSnapshot[]
}): ShipmentEtaBaseline {
  const activeBlocks = input.etaBlocks.filter((b) => b.status === 'active')

  if (input.isMultiPortLoading) {
    return {
      isMultiPortLoading: true,
      dischargeEta: { ...input.dischargeEta },
      singlePortActiveEta: null,
      loadingPorts: activeBlocks.map((block) => ({
        portSequence: block.portSequence,
        fields: pickLoadingFields(block.fields),
      })),
    }
  }

  const active = activeBlocks[0]
  return {
    isMultiPortLoading: false,
    dischargeEta: { ...input.dischargeEta },
    singlePortActiveEta: active ? { ...active.fields } : null,
    loadingPorts: [],
  }
}

export function hasShipmentEtaEdits(
  baseline: ShipmentEtaBaseline | null,
  input: {
    isMultiPortLoading: boolean
    dischargeEta: DischargeEtaFields
    etaBlocks: ShipmentEtaBlockSnapshot[]
  },
): boolean {
  if (!baseline) return false

  if (!input.isMultiPortLoading) {
    if (input.etaBlocks.some((b) => b.status === 'active' && b.isDraft)) return true
    const active = input.etaBlocks.find((b) => b.status === 'active')
    if (!active || !baseline.singlePortActiveEta) return false
    return ALL_ETA_KEYS.some(
      (key) => !etaDatesEqual(baseline.singlePortActiveEta![key], active.fields[key]),
    )
  }

  if (
    DISCHARGE_ETA_KEYS.some(
      (key) => !etaDatesEqual(baseline.dischargeEta[key], input.dischargeEta[key]),
    )
  ) {
    return true
  }

  for (const block of input.etaBlocks) {
    const base = baseline.loadingPorts.find((p) => p.portSequence === block.portSequence)
    if (
      LOADING_ETA_KEYS.some(
        (key) => !etaDatesEqual(base?.fields[key] ?? '', block.fields[key]),
      )
    ) {
      return true
    }
  }

  return false
}

const LOADING_ATA_KEYS: (keyof LoadingAtaFields)[] = [
  'ata_vessel_arrival_at_loading_port',
  'ata_vessel_berthed_at_loading_port',
  'ata_vessel_start_loading',
  'ata_vessel_completed_loading',
  'ata_vessel_sailed_from_loading_port',
]

const DISCHARGE_ATA_KEYS: ShipmentAtaApiField[] = [
  'ata_vessel_arrive_at_discharge_port',
  'ata_vessel_berthed_at_discharge_port',
  'ata_vessel_start_discharging',
  'ata_vessel_complete_discharge',
]

function normalizeAtaDate(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).trim().slice(0, 10)
}

function loadingAtaFieldsEqual(a: LoadingAtaFields, b: LoadingAtaFields): boolean {
  return LOADING_ATA_KEYS.every(
    (key) => normalizeAtaDate(a[key]) === normalizeAtaDate(b[key]),
  )
}

function dischargeOnlyAta(fields: ShipmentAtaFields): ShipmentAtaFields {
  const out = emptyAtaFields()
  for (const key of DISCHARGE_ATA_KEYS) {
    out[key] = fields[key] ?? ''
  }
  return out
}

export function hasShipmentAtaEdits(input: {
  isMultiPortLoading: boolean
  ataFields: ShipmentAtaFields
  originalAtaFields: ShipmentAtaFields
  loadingPortAtaByKey: Record<string, LoadingAtaFields>
  originalLoadingPortAtaByKey: Record<string, LoadingAtaFields>
}): boolean {
  if (input.isMultiPortLoading) {
    const keys = new Set([
      ...Object.keys(input.originalLoadingPortAtaByKey),
      ...Object.keys(input.loadingPortAtaByKey),
    ])
    for (const key of keys) {
      const current = input.loadingPortAtaByKey[key]
      const baseline = input.originalLoadingPortAtaByKey[key]
      if (!current && !baseline) continue
      if (!current || !baseline) return true
      if (!loadingAtaFieldsEqual(current, baseline)) return true
    }
    return (
      buildAtaOverridePayload(
        dischargeOnlyAta(input.ataFields),
        dischargeOnlyAta(input.originalAtaFields),
      ) != null
    )
  }

  return buildAtaOverridePayload(input.ataFields, input.originalAtaFields) != null
}

export function hasShipmentQualityEdits(
  baselineByPortKey: Record<string, ShipmentQualityFields>,
  currentByPortKey: Record<string, ShipmentQualityFields>,
): boolean {
  const keys = new Set([...Object.keys(baselineByPortKey), ...Object.keys(currentByPortKey)])
  for (const key of keys) {
    const baseline = baselineByPortKey[key]
    const current = currentByPortKey[key]
    if (!baseline && !current) continue
    if (!baseline || !current) return true
    if (!shipmentQualityFieldsEqual(baseline, current)) return true
  }
  return false
}

export function resolveCurrentQualityByPortKey(
  baselineByPortKey: Record<string, ShipmentQualityFields>,
  editsByPortKey: Record<string, ShipmentQualityFields>,
): Record<string, ShipmentQualityFields> {
  const out: Record<string, ShipmentQualityFields> = {}
  for (const [key, baseline] of Object.entries(baselineByPortKey)) {
    out[key] = editsByPortKey[key] ?? baseline
  }
  for (const [key, edited] of Object.entries(editsByPortKey)) {
    if (!out[key]) out[key] = edited
  }
  return out
}

export { DISCHARGE_QUALITY_PORT_KEY }
