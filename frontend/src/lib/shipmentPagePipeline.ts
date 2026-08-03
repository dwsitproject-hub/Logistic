/**
 * Shipments page Section 1 — 7-stage virtual pipeline (UI only).
 * Not used by Shipping Performance or other modules.
 */

export type ShipmentPagePipelineStage =
  | 'UNPLANNED'
  | 'PREPLANNED'
  | 'PLANNED'
  | 'AT_LOADING_PORT'
  | 'SAILED'
  | 'AT_DISCHARGE_PORT'
  | 'COMPLETED'
  | 'CANCELLED'

export type ShipmentPagePipelineStatusCounts = {
  unplanned: number
  preplanned: number
  planned: number
  atLoadingPort: number
  sailed: number
  atDischargePort: number
  completed: number
  cancelled: number
  total: number
}

export type LoadingPortBreakdown = {
  arrived: number
  berthed: number
  loading: number
  completedLoading: number
}

export type DischargePortBreakdown = {
  arrived: number
  berthed: number
  unloading: number
}

/** Sorted distinct non-blank vessel names per pipeline stage (Section 1 cards). */
export type ShipmentPagePipelineVesselNames = {
  unplanned: string[]
  preplanned: string[]
  planned: string[]
  atLoadingPort: string[]
  sailed: string[]
  atDischargePort: string[]
  completed: string[]
  cancelled: string[]
}

export type ShipmentPagePipelineSummary = {
  status: ShipmentPagePipelineStatusCounts
  statusVesselNames?: ShipmentPagePipelineVesselNames
  loadingPortBreakdown?: LoadingPortBreakdown
  dischargePortBreakdown?: DischargePortBreakdown
  statusContractQty?: ShipmentPagePipelineContractQtyKg
  statusOutstandingQty?: ShipmentPagePipelineOutstandingQtyKg
  unplannedTable?: {
    contractRows: number
    shipmentRows: number
    totalTableRows: number
  }
  outstandingQty?: {
    totalKg: number
    thirdParty: { fobKg: number; cifKg: number }
    interco: { fobKg: number; cifKg: number }
  }
}

export type ShipmentPagePipelineContractQtyKg = {
  unplanned: number
  preplanned: number
  planned: number
  completed: number
  cancelled: number
}

export type ShipmentPagePipelineOutstandingQtyKg = {
  atLoadingPort: number
  sailed: number
  atDischargePort: number
}

export type ShipmentPipelineCardQtyDisplay = {
  label: 'Contract Qty' | 'Outstanding Qty'
  kg: number
}

const SHIPMENT_CONTRACT_QTY_STAGES = new Set<ShipmentPagePipelineStage>([
  'UNPLANNED',
  'PREPLANNED',
  'PLANNED',
  'COMPLETED',
  'CANCELLED',
])

const SHIPMENT_OUTSTANDING_QTY_STAGES = new Set<ShipmentPagePipelineStage>([
  'AT_LOADING_PORT',
  'SAILED',
  'AT_DISCHARGE_PORT',
])

export function pipelineCardQtyForStage(
  stage: ShipmentPagePipelineStage,
  contractQty?: Partial<ShipmentPagePipelineContractQtyKg> | null,
  outstandingQty?: Partial<ShipmentPagePipelineOutstandingQtyKg> | null,
): ShipmentPipelineCardQtyDisplay | null {
  if (SHIPMENT_CONTRACT_QTY_STAGES.has(stage)) {
    const kg =
      stage === 'UNPLANNED'
        ? Number(contractQty?.unplanned ?? 0)
        : stage === 'PREPLANNED'
          ? Number(contractQty?.preplanned ?? 0)
          : stage === 'PLANNED'
            ? Number(contractQty?.planned ?? 0)
            : stage === 'COMPLETED'
              ? Number(contractQty?.completed ?? 0)
              : Number(contractQty?.cancelled ?? 0)
    return { label: 'Contract Qty', kg }
  }
  if (SHIPMENT_OUTSTANDING_QTY_STAGES.has(stage)) {
    const kg =
      stage === 'AT_LOADING_PORT'
        ? Number(outstandingQty?.atLoadingPort ?? 0)
        : stage === 'SAILED'
          ? Number(outstandingQty?.sailed ?? 0)
          : Number(outstandingQty?.atDischargePort ?? 0)
    return { label: 'Outstanding Qty', kg }
  }
  return null
}

export interface ShipmentPipelineCardConfig {
  status: ShipmentPagePipelineStage
  label: string
  color: string
  textColor: string
  badgeColor: string
  tooltip: string
  breakdown?: 'loading' | 'discharge'
}

export const SHIPMENT_PAGE_PIPELINE_CARDS: readonly ShipmentPipelineCardConfig[] = [
  {
    status: 'UNPLANNED',
    label: 'Unplanned',
    color: 'bg-slate-100',
    textColor: 'text-slate-800',
    badgeColor: 'bg-slate-600',
    tooltip:
      'Rows in the Unplanned view table: open contracts without a shipment record, plus unplanned STO/shipment execution groups (no ETA and no port milestones yet). The badge count matches the table row total.',
  },
  {
    status: 'PREPLANNED',
    label: 'Preplanned',
    color: 'bg-amber-100',
    textColor: 'text-amber-800',
    badgeColor: 'bg-amber-600',
    tooltip:
      'Unique accepted grouping suggestions that are not yet linked to a real shipment (no vessel/ETA entered). The badge counts groups, not individual contracts.',
  },
  {
    status: 'PLANNED',
    label: 'Planned',
    color: 'bg-blue-100',
    textColor: 'text-blue-800',
    badgeColor: 'bg-blue-600',
    tooltip: 'Shipments (STO/Operation ID) with ETA entered and not yet Completed or Cancelled.',
  },
  {
    status: 'AT_LOADING_PORT',
    label: 'At Loading Port',
    color: 'bg-orange-100',
    textColor: 'text-orange-800',
    badgeColor: 'bg-orange-600',
    tooltip:
      'Summary of shipments in In Progress or Loading status (detail status in the table is unchanged).',
    breakdown: 'loading',
  },
  {
    status: 'SAILED',
    label: 'Sailed to Disc Port',
    color: 'bg-purple-100',
    textColor: 'text-purple-800',
    badgeColor: 'bg-purple-600',
    tooltip: 'Summary of shipments in In Transit status (detail status in the table is unchanged).',
  },
  {
    status: 'AT_DISCHARGE_PORT',
    label: 'At Discharge Port',
    color: 'bg-cyan-100',
    textColor: 'text-cyan-800',
    badgeColor: 'bg-cyan-600',
    tooltip:
      'Summary of shipments in Arrived or Unloading status (detail status in the table is unchanged).',
    breakdown: 'discharge',
  },
  {
    status: 'COMPLETED',
    label: 'Completed',
    color: 'bg-green-100',
    textColor: 'text-green-800',
    badgeColor: 'bg-green-600',
    tooltip: 'Shipment complete — cargo received at destination or contract closed in SAP.',
  },
  {
    status: 'CANCELLED',
    label: 'Cancelled',
    color: 'bg-red-100',
    textColor: 'text-red-800',
    badgeColor: 'bg-red-600',
    tooltip: 'Shipment cancelled and will not continue.',
  },
] as const

export function pipelineCountForStage(
  stage: ShipmentPagePipelineStage,
  counts: ShipmentPagePipelineStatusCounts,
): number {
  switch (stage) {
    case 'UNPLANNED':
      return counts.unplanned
    case 'PREPLANNED':
      return counts.preplanned
    case 'PLANNED':
      return counts.planned
    case 'AT_LOADING_PORT':
      return counts.atLoadingPort
    case 'SAILED':
      return counts.sailed
    case 'AT_DISCHARGE_PORT':
      return counts.atDischargePort
    case 'COMPLETED':
      return counts.completed
    case 'CANCELLED':
      return counts.cancelled
    default:
      return 0
  }
}

export function pipelineVesselNamesForStage(
  stage: ShipmentPagePipelineStage,
  vessels: ShipmentPagePipelineVesselNames | undefined,
): string[] | null {
  if (!vessels) return null
  switch (stage) {
    case 'UNPLANNED':
      return vessels.unplanned
    case 'PREPLANNED':
      return vessels.preplanned
    case 'PLANNED':
      return vessels.planned
    case 'AT_LOADING_PORT':
      return vessels.atLoadingPort
    case 'SAILED':
      return vessels.sailed
    case 'AT_DISCHARGE_PORT':
      return vessels.atDischargePort
    case 'COMPLETED':
      return vessels.completed
    case 'CANCELLED':
      return vessels.cancelled
    default:
      return null
  }
}

/** How many vessel names are shown directly on a card before "+N more". */
export const PIPELINE_CARD_VESSEL_PREVIEW_LIMIT = 3

export function splitVesselNamesForCard(names: string[]): {
  preview: string[]
  moreCount: number
} {
  return {
    preview: names.slice(0, PIPELINE_CARD_VESSEL_PREVIEW_LIMIT),
    moreCount: Math.max(0, names.length - PIPELINE_CARD_VESSEL_PREVIEW_LIMIT),
  }
}

export function formatLoadingPortBreakdownTooltip(b: LoadingPortBreakdown): string {
  return [
    'Loading port breakdown:',
    `Arrived: ${b.arrived.toLocaleString('en-US')}`,
    `Berthed: ${b.berthed.toLocaleString('en-US')}`,
    `Loading: ${b.loading.toLocaleString('en-US')}`,
    `Completed Loading: ${b.completedLoading.toLocaleString('en-US')}`,
  ].join('\n')
}

export function formatDischargePortBreakdownTooltip(b: DischargePortBreakdown): string {
  return [
    'Discharge port breakdown:',
    `Arrived: ${b.arrived.toLocaleString('en-US')}`,
    `Berthed: ${b.berthed.toLocaleString('en-US')}`,
    `Unloading: ${b.unloading.toLocaleString('en-US')}`,
  ].join('\n')
}

export const SHIPMENT_PAGE_PIPELINE_LABELS: Record<ShipmentPagePipelineStage, string> =
  Object.fromEntries(
    SHIPMENT_PAGE_PIPELINE_CARDS.map((c) => [c.status, c.label]),
  ) as Record<ShipmentPagePipelineStage, string>
