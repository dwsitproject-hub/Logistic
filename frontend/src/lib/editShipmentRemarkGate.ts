import type { DischargeEtaFields, EditEtaFields, LoadingEtaFields } from '@/lib/editShipmentModalSave'

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
