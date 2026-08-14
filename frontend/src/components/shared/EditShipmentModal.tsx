'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DateInputDdMmYyyy } from '@/components/DateInputDdMmYyyy'
import {
  AlertCircle,
  Anchor,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Edit2,
  FileText,
  FlaskConical,
  Gauge,
  History,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  Ship,
  Upload,
  Download,
  X,
} from 'lucide-react'
import { MasterVesselCombobox, type MasterVesselOption } from '@/components/MasterVesselCombobox'
import { charterTypeFromMasterTerms } from '@/lib/masterVesselTerms'
import {
  hasKlipVesselNameOverride,
  shipmentVesselPrimaryName,
} from '@/lib/shipmentVesselCompare'
import { invalidateMissingEtaAlertCache } from '@/lib/clientDataCache'
import {
  resolveShipmentApiLookupKey,
  resolveShipmentDisplayStoNumber,
} from '@/lib/shipmentStoDisplay'
import { formatDateDMY, formatDateTimeDMY, toApiDateOnly } from '@/lib/dateFormat'
import { formatVesselCodeDisplay } from '@/lib/formatVesselCodeDisplay'
import api from '@/lib/api'
import { cn, formatQtyMtFromKg } from '@/lib/utils'
import { formatSapDisplayValue } from '@/lib/sapDisplayValue'
import { resolveLoadingPortDisplayFromRow, resolveKlipPortInputValue } from '@/lib/loadingPortDisplay'
import { hasVesselPortsQuantityUserEdits } from '@/lib/vesselPortsQuantityEdits'
import {
  seedKlipQtyFromShipmentHeader,
  sapContractDetailQtyToKg,
  shipmentStoredQtyKg,
} from '@/lib/shipmentQuantityUnits'
import {
  sumVesselPortsQuantityEdits,
  type VesselPortsQuantityEdits,
  type VesselPortsQuantityRow,
} from '@/components/shipments/VesselPortsQuantitiesTable'
import type { AddNewShipmentSubmitPayload, ShipmentEditContextData, ShipmentPoOption } from '@/components/shared/addNewShipmentTypes'
import { attachPurchaseOrderToShipment, batchSaveShipmentPoPlanQty, shipmentPlanQtyExceedsOsActual } from '@/components/shared/addNewShipmentTypes'
import { ShipmentPoSearchCombobox } from '@/components/shared/ShipmentPoSearchCombobox'
import {
  ContractDetailModal,
  fetchContractForDetailModalByPo,
  type ContractDetailModalContract,
} from '@/components/contracts/ContractDetailModal'
import {
  VESSEL_MODAL_BODY_CLASS,
  VESSEL_MODAL_COMPACT_TD,
  VESSEL_MODAL_COMPACT_TH,
  VESSEL_MODAL_FOOTER_BAR_CLASS,
  VESSEL_MODAL_HEADER_CLASS,
  VESSEL_MODAL_OVERLAY_CLASS,
  VESSEL_MODAL_PANEL_CLASS,
  VESSEL_MODAL_SECTION_CLASS,
  VESSEL_MODAL_STEP_STRIP_CLASS,
  VESSEL_MODAL_TABLE_FOOTER_CLASS,
  vesselModalSectionHeaderClass,
} from '@/lib/vesselModalUi'
import {
  saveEditShipmentChanges,
  saveShipmentEditRemark,
  type DischargeEtaFields,
  type EditEtaFields,
  type LoadingAtaFields,
  type LoadingPortRef,
} from '@/lib/editShipmentModalSave'
import { FieldHelp } from '@/components/FieldHelp'
import { computeShipmentFreightBudgetIdrKg } from '@/lib/shipmentTcFreightBudget'
import { computeShipmentR4ShortageMt } from '@/lib/shipmentTcR4Shortage'
import { TC_VESSEL_PERF_LABELS, TC_VESSEL_PERF_TOOLTIPS } from '@/lib/shipmentTcPerformanceLabels'
import {
  buildShipmentEtaBaseline,
  DISCHARGE_QUALITY_PORT_KEY,
  hasShipmentAtaEdits,
  hasShipmentQualityEdits,
  hasShipmentEtaEdits,
  resolveCurrentQualityByPortKey,
  type ShipmentEtaBaseline,
  type ShipmentEtaBlockSnapshot,
} from '@/lib/editShipmentRemarkGate'
import {
  shipmentQualityFieldsFromPort,
  emptyShipmentQualityFields,
  qualitySapReferenceFromPort,
  type ShipmentQualityFields,
} from '@/lib/shipmentQualityFields'
import {
  KlipSapCompareField,
  KlipSapCompareLegend,
} from '@/components/shared/KlipSapCompareField'
import { hasKlipSapMismatch } from '@/lib/klipSapCompare'
import {
  SectionActionGroup,
  SectionAddButton,
  SectionCancelButton,
  SectionEditButton,
} from '@/components/shared/ShipmentModalSectionActions'
import {
  ataFieldsFromShipmentInfo,
  ataSapReferenceFromShipmentInfo,
  emptyAtaFields,
  loadingAtaSapFromPortRow,
  type ShipmentAtaApiField,
  type ShipmentAtaFields,
} from '@/lib/shipmentAtaFields'
import {
  usePermissions,
  canCreatePermission,
  canEditPermission,
} from '@/components/PermissionsContext'
import {
  formatShipmentStatusLabel,
  normalizeShipmentStatusKey,
  shipmentStatusBadgeClass,
} from '@/lib/shipmentStatusDisplay'
const SHIPMENT_SLD_DOC_TYPE = 'SLD'
const SHIPMENT_SDD_DOC_TYPE = 'SDD'

interface ShipmentDocumentItem {
  id: string
  document_type?: string
  file_name: string
  created_at?: string
}
const ETA_INFO_VALUE_CLASS = 'text-sm font-medium text-gray-900 tabular-nums'
const INFO_VALUE_CLASS = 'text-sm font-medium text-gray-900'
const VESSEL_MODAL_TABLE_QTY_VALUE_CLASS = 'text-xs font-normal tabular-nums text-gray-900'

const LOADING_ETA_FIELD_ROWS: { key: keyof EditEtaFields; label: string }[] = [
  { key: 'etaVesselArrivalAtLoadingPort', label: 'ETA at Loading Port' },
  { key: 'etaVesselBerthedAtLoadingPort', label: 'ETB at Loading Port' },
  { key: 'etaVesselStartLoading', label: 'ETS Loading' },
  { key: 'etaVesselCompletedLoading', label: 'ETC Loading' },
  { key: 'etaVesselSailedFromLoadingPort', label: 'ET Sailed to Discharge Port' },
]

const DISCHARGE_ETA_FIELD_ROWS: { key: keyof DischargeEtaFields; label: string }[] = [
  { key: 'etaVesselArriveAtDischargePort', label: 'ETA at Discharge Port' },
  { key: 'etaVesselBerthedAtDischargePort', label: 'ETB at Discharge Port' },
  { key: 'etaVesselStartDischarging', label: 'ETS at Discharge Port' },
  { key: 'etaVesselCompleteDischarge', label: 'ETC at Discharge Port' },
]

const ETA_FIELD_ROWS: { key: keyof EditEtaFields; label: string }[] = [
  ...LOADING_ETA_FIELD_ROWS,
  ...DISCHARGE_ETA_FIELD_ROWS,
]

const ATA_FIELD_ROWS: { key: ShipmentAtaApiField; label: string }[] = [
  { key: 'ata_vessel_arrival_at_loading_port', label: 'ATA at Loading Port' },
  { key: 'ata_vessel_berthed_at_loading_port', label: 'ATB at Loading Port' },
  { key: 'ata_vessel_start_loading', label: 'ATS Loading' },
  { key: 'ata_vessel_completed_loading', label: 'ATC Loading' },
  { key: 'ata_vessel_sailed_from_loading_port', label: 'AT Sailed to Discharge Port' },
  { key: 'ata_vessel_arrive_at_discharge_port', label: 'ATA at Discharge Port' },
  { key: 'ata_vessel_berthed_at_discharge_port', label: 'ATB at Discharge Port' },
  { key: 'ata_vessel_start_discharging', label: 'ATS Discharge' },
  { key: 'ata_vessel_complete_discharge', label: 'ATC Discharge' },
]

// Use "discharg" so both "...discharge..." and "...discharging..." count as discharge ATA.
const LOADING_ATA_FIELD_ROWS = ATA_FIELD_ROWS.filter((row) => !row.key.includes('discharg'))

const DISCHARGE_ATA_FIELD_ROWS = ATA_FIELD_ROWS.filter((row) => row.key.includes('discharg'))

const QUALITY_METRICS: { portKey: string; label: string }[] = [
  { portKey: 'quality_ffa', label: 'FFA' },
  { portKey: 'quality_mi', label: 'M&I' },
  { portKey: 'quality_dobi', label: 'DOBI' },
  { portKey: 'quality_red', label: 'Color' },
  { portKey: 'quality_ds', label: 'D&S' },
  { portKey: 'quality_stone', label: 'Stone' },
]

function emptyDischargeEtaFields(): DischargeEtaFields {
  return {
    etaVesselArriveAtDischargePort: '',
    etaVesselBerthedAtDischargePort: '',
    etaVesselStartDischarging: '',
    etaVesselCompleteDischarge: '',
  }
}

function emptyEtaFields(): EditEtaFields {
  return {
    ...emptyDischargeEtaFields(),
    etaVesselArrivalAtLoadingPort: '',
    etaVesselBerthedAtLoadingPort: '',
    etaVesselStartLoading: '',
    etaVesselCompletedLoading: '',
    etaVesselSailedFromLoadingPort: '',
  }
}

function dischargeEtaFromInfo(
  info: Record<string, unknown>,
  row: Record<string, unknown>,
): DischargeEtaFields {
  return {
    etaVesselArriveAtDischargePort:
      sliceIsoDate(info.eta_vessel_arrive_at_discharge_port as string) ||
      sliceIsoDate(row.eta_discharge_arrival as string),
    etaVesselBerthedAtDischargePort:
      sliceIsoDate(info.eta_vessel_berthed_at_discharge_port as string) ||
      sliceIsoDate(row.eta_discharge_berthed as string),
    etaVesselStartDischarging:
      sliceIsoDate(info.eta_vessel_start_discharging as string) ||
      sliceIsoDate(row.eta_discharge_start as string),
    etaVesselCompleteDischarge:
      sliceIsoDate(info.eta_vessel_complete_discharge as string) ||
      sliceIsoDate(row.eta_discharge_complete as string),
  }
}

function loadingAtaFromPortRow(
  portRow: LoadingPortRef | undefined,
  info: Record<string, unknown>,
): LoadingAtaFields {
  return {
    ata_vessel_arrival_at_loading_port:
      sliceIsoDate(portRow?.ata_vessel_arrival as string) ||
      sliceIsoDate(info.ata_vessel_arrival_at_loading_port as string),
    ata_vessel_berthed_at_loading_port:
      sliceIsoDate(portRow?.ata_vessel_berthed as string) ||
      sliceIsoDate(info.ata_vessel_berthed_at_loading_port as string),
    ata_vessel_start_loading:
      sliceIsoDate(portRow?.ata_loading_start as string) ||
      sliceIsoDate(info.ata_vessel_start_loading as string),
    ata_vessel_completed_loading:
      sliceIsoDate(portRow?.ata_loading_completed as string) ||
      sliceIsoDate(info.ata_vessel_completed_loading as string),
    ata_vessel_sailed_from_loading_port:
      sliceIsoDate(portRow?.ata_vessel_sailed as string) ||
      sliceIsoDate(info.ata_vessel_sailed_from_loading_port as string),
  }
}

function loadingPortAtaStateKey(portRow: Pick<LoadingPortRef, 'id' | 'port_sequence'>): string {
  if (portRow.id && String(portRow.id).trim()) return String(portRow.id).trim()
  return `seq-${portRow.port_sequence ?? 1}`
}

function buildQualityBaselineFromPorts(
  loadingPortRows: LoadingPortRef[],
  dischargePortRow: LoadingPortRef | undefined,
  info: Record<string, unknown>,
  anchorShipmentId: string,
): Record<string, ShipmentQualityFields> {
  const out: Record<string, ShipmentQualityFields> = {}
  for (const portRow of loadingPortRows) {
    const isAnchor =
      Boolean(portRow.shipment_id) && String(portRow.shipment_id) === anchorShipmentId
    out[loadingPortAtaStateKey(portRow)] = shipmentQualityFieldsFromPort(
      portRow as Record<string, unknown>,
      isAnchor ? info : {},
      `quality_at_loading_loc_${portRow.port_sequence ?? 1}`,
    )
  }
  if (dischargePortRow) {
    out[DISCHARGE_QUALITY_PORT_KEY] = shipmentQualityFieldsFromPort(
      dischargePortRow as Record<string, unknown>,
      info,
      'quality_at_discharge_loc_1',
    )
  }
  return out
}

function loadingEtaFromPortRow(
  portRow: LoadingPortRef | undefined,
  info: Record<string, unknown>,
  row: Record<string, unknown>,
): EditEtaFields {
  return {
    etaVesselArrivalAtLoadingPort:
      sliceIsoDate(portRow?.eta_vessel_arrival as string) ||
      sliceIsoDate(info.eta_vessel_arrival_at_loading_port as string) ||
      sliceIsoDate(row.eta_arrival as string),
    etaVesselBerthedAtLoadingPort:
      sliceIsoDate(portRow?.eta_vessel_berthed_at_loading_port as string) ||
      sliceIsoDate(info.eta_vessel_berthed_at_loading_port as string) ||
      sliceIsoDate(row.eta_berthed as string),
    etaVesselStartLoading:
      sliceIsoDate(portRow?.eta_loading_start as string) ||
      sliceIsoDate(info.eta_vessel_start_loading as string) ||
      sliceIsoDate(row.eta_loading_start as string),
    etaVesselCompletedLoading:
      sliceIsoDate(portRow?.eta_loading_completed as string) ||
      sliceIsoDate(info.eta_vessel_completed_loading as string) ||
      sliceIsoDate(row.eta_loading_complete as string),
    etaVesselSailedFromLoadingPort:
      sliceIsoDate(portRow?.eta_vessel_sailed as string) ||
      sliceIsoDate(info.eta_vessel_sailed_from_loading_port as string) ||
      sliceIsoDate(row.eta_sailed as string),
    ...emptyDischargeEtaFields(),
  }
}

function sliceIsoDate(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function parseApiNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = String(value).replace(/,/g, '').trim()
  if (!normalized) return null
  const parsed = parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function mergeContractNumberLists(...sources: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const src of sources) {
    for (const part of String(src ?? '').split(',')) {
      const trimmed = part.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

function formatInfoDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const text = String(value).trim()
  return text || '—'
}

function ReadOnlyInfoField({
  label,
  value,
  compact = false,
  className,
  helpText,
}: {
  label: string
  value: unknown
  compact?: boolean
  className?: string
  helpText?: string
}) {
  return (
    <div className={className}>
      <label
        className={
          compact
            ? 'mb-1 block text-[10px] font-medium text-gray-600'
            : 'mb-1 block text-xs font-medium text-gray-600'
        }
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {helpText ? <FieldHelp text={helpText} /> : null}
        </span>
      </label>
      <div
        className={
          compact
            ? `flex min-h-8 items-center ${ETA_INFO_VALUE_CLASS}`
            : INFO_VALUE_CLASS
        }
      >
        {formatInfoDisplayValue(value)}
      </div>
    </div>
  )
}

function MtQtyInput({
  valueKg,
  disabled,
  onChange,
}: {
  valueKg: number | null
  disabled?: boolean
  onChange: (kg: number | null) => void
}) {
  if (disabled) {
    return (
      <div className="text-right">
        <div
          className={`flex min-h-0 items-center justify-end ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}
        >
          {valueKg === null ? '—' : formatQtyMtFromKg(valueKg)}
        </div>
      </div>
    )
  }

  const mtDisplay = valueKg === null ? '' : String(valueKg / 1000)
  return (
    <div className="text-right">
      <div className="relative w-full min-w-[5.5rem]">
        <Input
          type="number"
          step="0.01"
          value={mtDisplay}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              onChange(0)
              return
            }
            const mt = parseFloat(raw)
            onChange(Number.isNaN(mt) ? 0 : mt * 1000)
          }}
          className={`h-7 px-2 py-1 pr-9 text-right ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-normal text-gray-500">
          MT
        </span>
      </div>
    </div>
  )
}

function MtQtyReadOnly({ valueKg }: { valueKg: number | null | undefined }) {
  if (valueKg === null || valueKg === undefined) {
    return (
      <div className={`text-right ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}>
        <div>—</div>
      </div>
    )
  }
  const kg = typeof valueKg === 'number' ? valueKg : Number(String(valueKg).replace(/,/g, '').trim())
  if (!Number.isFinite(kg)) {
    return (
      <div className={`text-right ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}>
        <div>—</div>
      </div>
    )
  }
  return (
    <div className={`text-right ${VESSEL_MODAL_TABLE_QTY_VALUE_CLASS}`}>
      <div>{formatQtyMtFromKg(kg)}</div>
    </div>
  )
}

/** T/C, TC, T-C, "Time Charter" all normalize to true. Mirrors backend normalizeCharterType. */
function isTcCharterType(value: unknown): boolean {
  const raw = String(value ?? '').trim().toUpperCase()
  if (!raw) return false
  if (raw === 'T/C' || raw === 'TC' || raw === 'T-C' || raw === 'TIME CHARTER') return true
  return raw.includes('TIME')
}

/** Plain decimal metric input (not KG-scaled) for TC vessel performance fields. */
function MetricDecimalInput({
  value,
  onChange,
  unit,
}: {
  value: number | null
  onChange: (value: number | null) => void
  unit?: string
}) {
  return (
    <div className="relative w-full">
      <Input
        type="number"
        step="0.01"
        value={value === null ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') {
            onChange(null)
            return
          }
          const parsed = parseFloat(raw)
          onChange(Number.isNaN(parsed) ? null : parsed)
        }}
        className={`h-9 text-right ${unit ? 'pr-12' : ''}`}
      />
      {unit && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-normal text-gray-500">
          {unit}
        </span>
      )}
    </div>
  )
}

function formatMetricReadOnly(value: number | null, unit?: string): string | null {
  if (value === null) return null
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value)
}

type ShipmentDetailRow = {
  rowKey: string
  contract_number: string
  po_number: string
  supplier: string
  product: string
  contract_qty: number
  outstanding_qty_actual: number
  outstanding_qty_planning: number
  outstanding_qty_planning_budget: number
  sap_sto_qty: number
  shipment_plan_qty: number
  /** @deprecated alias for shipment_plan_qty */
  sto_qty_assigned: number
  /** @deprecated alias for outstanding_qty_actual */
  outstanding_qty: number
  /** SAP STO-scoped delivered (read-only in PO table). */
  quantity_delivered_sap: number | null
  /** SAP STO-scoped receive (read-only in PO table). */
  quantity_receive_sap: number | null
  /** KLIP delivered seed (editable after SLD/SDD). */
  quantity_delivered_klip: number | null
  /** KLIP receive seed (editable after SLD/SDD). */
  quantity_receive_klip: number | null
  /** SAP Vessel OA Budget (IDR/KG) for this PO line. */
  vessel_oa_budget_sap: number | null
}

async function fetchContractValidateEnrichment(contractNumber: string): Promise<{
  supplier: string
  product: string
  po_number: string
  contract_qty: number
  outstanding_qty: number
}> {
  try {
    const valRes = await api.get(
      `/shipments/contracts/validate?contract_number=${encodeURIComponent(contractNumber)}`,
    )
    const cd = valRes.data?.data as Record<string, unknown> | undefined
    return {
      supplier: String(cd?.supplier ?? ''),
      product: String(cd?.product ?? ''),
      po_number: String(cd?.po_number ?? ''),
      contract_qty: parseApiNumber(cd?.quantity_ordered) ?? 0,
      outstanding_qty: parseApiNumber(cd?.outstanding_quantity) ?? 0,
    }
  } catch {
    return {
      supplier: '',
      product: '',
      po_number: '',
      contract_qty: 0,
      outstanding_qty: 0,
    }
  }
}

function contractDetailRowFromApi(
  d: Record<string, unknown>,
  shipmentId: string,
): ShipmentDetailRow {
  const cn = String(d.contract_number ?? '').trim()
  const po = String(d.po_number ?? '').trim()
  const shipmentPlanQty = parseApiNumber(d.shipment_plan_qty ?? d.sto_qty_assigned) ?? 0
  const contractQty = parseApiNumber(d.contract_qty) ?? 0
  const osActual = parseApiNumber(d.outstanding_qty_actual ?? d.outstanding_qty) ?? 0
  const osPlan = parseApiNumber(d.outstanding_qty_planning) ?? 0
  const osPlanBudget = parseApiNumber(d.outstanding_qty_planning_budget) ?? osPlan
  return {
    rowKey: `${shipmentId}-${cn}-${po || 'po'}`,
    contract_number: cn,
    po_number: po,
    supplier: String(d.supplier ?? '').trim(),
    product: String(d.product ?? '').trim(),
    contract_qty: contractQty,
    outstanding_qty_actual: osActual,
    outstanding_qty_planning: osPlan,
    outstanding_qty_planning_budget: osPlanBudget,
    sap_sto_qty: parseApiNumber(d.sap_sto_qty) ?? 0,
    shipment_plan_qty: shipmentPlanQty,
    sto_qty_assigned: shipmentPlanQty,
    outstanding_qty: osActual,
    quantity_delivered_sap: sapContractDetailQtyToKg(parseApiNumber(d.quantity_delivered), contractQty),
    quantity_receive_sap: sapContractDetailQtyToKg(parseApiNumber(d.quantity_receive), contractQty),
    quantity_delivered_klip: shipmentStoredQtyKg(parseApiNumber(d.quantity_delivered_klip)),
    quantity_receive_klip: shipmentStoredQtyKg(parseApiNumber(d.quantity_receive_klip)),
    vessel_oa_budget_sap: parseApiNumber(d.vessel_oa_budget_sap),
  }
}

async function buildContractDetailRows(
  detailsData: Array<Record<string, unknown>>,
  shipmentId: string,
  contractNumbers: string[],
): Promise<ShipmentDetailRow[]> {
  let contractDetails = detailsData.map((d) => contractDetailRowFromApi(d, shipmentId))

  const needsEnrichment = contractDetails
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.contract_number && !row.supplier && !row.product)

  if (needsEnrichment.length > 0) {
    const enrichments = await Promise.all(
      needsEnrichment.map(({ row }) => fetchContractValidateEnrichment(row.contract_number)),
    )
    contractDetails = contractDetails.map((row, index) => {
      const enrichIdx = needsEnrichment.findIndex((item) => item.index === index)
      if (enrichIdx < 0) return row
      const enriched = enrichments[enrichIdx]
      return {
        ...row,
        supplier: row.supplier || enriched.supplier,
        product: row.product || enriched.product,
      }
    })
  }

  if (contractDetails.length === 0 && contractNumbers.length > 0) {
    const enrichments = await Promise.all(
      contractNumbers.map((cn) => fetchContractValidateEnrichment(cn)),
    )
    contractDetails = contractNumbers.map((cn, i) => {
      const enriched = enrichments[i]
      return {
        rowKey: `${shipmentId}-${cn}`,
        contract_number: cn,
        po_number: enriched.po_number,
        supplier: enriched.supplier,
        product: enriched.product,
        contract_qty: enriched.contract_qty,
        outstanding_qty_actual: enriched.outstanding_qty,
        outstanding_qty_planning: enriched.outstanding_qty,
        outstanding_qty_planning_budget: enriched.outstanding_qty,
        sap_sto_qty: 0,
        shipment_plan_qty: 0,
        sto_qty_assigned: 0,
        outstanding_qty: enriched.outstanding_qty,
        quantity_delivered_sap: null,
        quantity_receive_sap: null,
        quantity_delivered_klip: null,
        quantity_receive_klip: null,
        vessel_oa_budget_sap: null,
      }
    })
  }

  return contractDetails
}

type EtaBlock = {
  id: string
  portId?: string
  portSequence: number
  status: 'active' | 'historical'
  loadingPort: string
  contractLabels: string[]
  fields: EditEtaFields
  isEditing: boolean
  /** Unsaved block created via Add — Cancel restores the previous active ETA. */
  isDraft?: boolean
}

type ActivityLogRow = {
  id: string
  action: string
  entity_type: string
  timestamp: string
  username?: string
  full_name?: string
  before_data?: Record<string, unknown> | null
  after_data?: Record<string, unknown> | null
}

type ShipmentRemarkRow = {
  id: string
  text: string
  category?: string | null
  created_at?: string | null
  username?: string
  full_name?: string
}

function formatShipmentRemarkAuthor(remark: ShipmentRemarkRow): string {
  return remark.full_name?.trim() || remark.username?.trim() || '—'
}

function formatShipmentRemarkCategory(category?: string | null): string | null {
  const key = String(category ?? '').trim().toUpperCase()
  if (key === 'CANCEL_SHIPMENT') return 'Shipment cancellation'
  if (key === 'EDIT_SHIPMENT') return 'Edit shipment'
  return null
}

function formatActivityLabel(log: ActivityLogRow): string {
  const user = log.full_name?.trim() || log.username?.trim() || 'Unknown User'
  const entity = log.entity_type?.replace(/_/g, ' ') ?? 'Record'
  const action = log.action?.toUpperCase() ?? 'UPDATE'
  if (action === 'UPDATE' && log.entity_type === 'SHIPMENT') return `Updated Shipment — ${user}`
  if (action === 'CREATE' && log.entity_type === 'LOADING_PORT') return `Added Loading Port — ${user}`
  if (action === 'UPDATE' && log.entity_type === 'LOADING_PORT') return `Updated Estimation / Port — ${user}`
  if (action === 'CANCEL' && log.entity_type === 'LOADING_PORT') return `Cancelled Port Activity — ${user}`
  if (action === 'CANCEL' && log.entity_type === 'SHIPMENT') return `Cancelled Shipment — ${user}`
  return `${action} ${entity} — ${user}`
}

export type EditShipmentModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (payload: AddNewShipmentSubmitPayload) => Promise<void>
  editContractId?: string | null
  editShipmentId?: string | null
  /** STO from Shipments list row (sto_key / displayed sto_number). */
  editStoNumber?: string | null
  /** All contract numbers on the grouped list row (comma-separated). */
  editContractNumbers?: string | null
  /** Read-only mode (e.g. Cancelled shipments on Shipments view table). */
  readOnly?: boolean
  /** Allow ATA + Quality edits while core sections stay read-only (View Shipment). */
  enableAtaQualityEditInView?: boolean
  /** Raise z-index when opened above contract detail modal. */
  stacked?: boolean
  /** Called after PO attach so parent can refresh Shipments list. */
  onShipmentChanged?: () => void
}

export function EditShipmentModal({
  open,
  onClose,
  onSubmit,
  editContractId = null,
  editShipmentId: editShipmentIdProp = null,
  editStoNumber = null,
  editContractNumbers = null,
  readOnly = false,
  enableAtaQualityEditInView = false,
  stacked = false,
  onShipmentChanged,
}: EditShipmentModalProps) {
  const perms = usePermissions()
  const canEditShipment = canEditPermission(perms, 'data.shipments')
  const canAddShipment = canCreatePermission(perms, 'data.shipments')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [shipmentId, setShipmentId] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const [vesselName, setVesselName] = useState('')
  const [originalVesselName, setOriginalVesselName] = useState('')
  const [sapVesselName, setSapVesselName] = useState('')
  const [pendingMasterVessel, setPendingMasterVessel] = useState<MasterVesselOption | null>(null)
  const [vesselMeta, setVesselMeta] = useState<Record<string, string>>({})
  const [operationId, setOperationId] = useState('')
  const [stoNumber, setStoNumber] = useState('')
  const [plantSiteName, setPlantSiteName] = useState('')

  const [detailRows, setDetailRows] = useState<ShipmentDetailRow[]>([])
  const [contractDetailTarget, setContractDetailTarget] =
    useState<ContractDetailModalContract | null>(null)
  const [contractDetailLoading, setContractDetailLoading] = useState(false)
  const [planQtyEdits, setPlanQtyEdits] = useState<Record<string, number>>({})
  const [qtyEdits, setQtyEdits] = useState<VesselPortsQuantityEdits>({})
  const [sfalQty, setSfalQty] = useState<number | null>(null)
  const [sfbdQty, setSfbdQty] = useState<number | null>(null)
  const [originalSfalQty, setOriginalSfalQty] = useState<number | null>(null)
  const [originalSfbdQty, setOriginalSfbdQty] = useState<number | null>(null)
  // TC (Time Charter) vessel performance metrics - manually entered, SAP does not feed these.
  const [fuelConsumption, setFuelConsumption] = useState<number | null>(null)
  const [freight, setFreight] = useState<number | null>(null)
  const [pumpRate, setPumpRate] = useState<number | null>(null)
  const [sailingSpeed, setSailingSpeed] = useState<number | null>(null)
  const [originalFuelConsumption, setOriginalFuelConsumption] = useState<number | null>(null)
  const [originalFreight, setOriginalFreight] = useState<number | null>(null)
  const [originalPumpRate, setOriginalPumpRate] = useState<number | null>(null)
  const [originalSailingSpeed, setOriginalSailingSpeed] = useState<number | null>(null)
  const [originalShortage, setOriginalShortage] = useState<number | null>(null)
  const [originalDeliveredKg, setOriginalDeliveredKg] = useState<number | null>(null)
  const [originalReceiveKg, setOriginalReceiveKg] = useState<number | null>(null)

  const [hasUploadedSld, setHasUploadedSld] = useState(false)
  const [hasUploadedSdd, setHasUploadedSdd] = useState(false)
  const [sldDocUploading, setSldDocUploading] = useState(false)
  const [sddDocUploading, setSddDocUploading] = useState(false)
  const [shipmentStatus, setShipmentStatus] = useState<string | null>(null)
  const [shipmentDocuments, setShipmentDocuments] = useState<ShipmentDocumentItem[]>([])
  const [docsLoading, setDocsLoading] = useState(false)

  const [loadingPort, setLoadingPort] = useState('')
  const [dischargePort, setDischargePort] = useState('')
  const [loadingPorts, setLoadingPorts] = useState<LoadingPortRef[]>([])
  const [etaBlocks, setEtaBlocks] = useState<EtaBlock[]>([])
  const [dischargeEtaFields, setDischargeEtaFields] = useState<DischargeEtaFields>(emptyDischargeEtaFields)
  const [etaSectionEditing, setEtaSectionEditing] = useState(false)
  const [isMultiPortLoading, setIsMultiPortLoading] = useState(false)
  const [shipmentInfo, setShipmentInfo] = useState<Record<string, unknown>>({})
  const [ataFields, setAtaFields] = useState<ShipmentAtaFields>(emptyAtaFields)
  const [originalAtaFields, setOriginalAtaFields] = useState<ShipmentAtaFields>(emptyAtaFields)
  const [ataSapReference, setAtaSapReference] = useState<ShipmentAtaFields>(emptyAtaFields)
  const [ataIsEditing, setAtaIsEditing] = useState(false)
  const [loadingPortAtaByKey, setLoadingPortAtaByKey] = useState<Record<string, LoadingAtaFields>>({})
  const [originalLoadingPortAtaByKey, setOriginalLoadingPortAtaByKey] = useState<
    Record<string, LoadingAtaFields>
  >({})
  const [qualityIsEditing, setQualityIsEditing] = useState(false)
  const [showAtaDifferencesOnly, setShowAtaDifferencesOnly] = useState(false)
  const [showQualityDifferencesOnly, setShowQualityDifferencesOnly] = useState(false)
  const [qualityEditsByPortKey, setQualityEditsByPortKey] = useState<
    Record<string, ShipmentQualityFields>
  >({})
  const [originalQualityByPortKey, setOriginalQualityByPortKey] = useState<
    Record<string, ShipmentQualityFields>
  >({})
  const [activityLog, setActivityLog] = useState<ActivityLogRow[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [shipmentRemarks, setShipmentRemarks] = useState<ShipmentRemarkRow[]>([])
  const [shipmentRemarksLoading, setShipmentRemarksLoading] = useState(false)

  const [editContext, setEditContext] = useState<ShipmentEditContextData | null>(null)
  const [selectedAddPoOption, setSelectedAddPoOption] = useState<ShipmentPoOption | null>(null)
  const [addingPo, setAddingPo] = useState(false)
  const [editRemark, setEditRemark] = useState('')
  const [etaBaseline, setEtaBaseline] = useState<ShipmentEtaBaseline | null>(null)

  const initSessionRef = useRef<string | null>(null)

  const isQuantityUnlocked = hasUploadedSld || hasUploadedSdd
  const isCancelledShipment = normalizeShipmentStatusKey(shipmentStatus) === 'CANCELLED'
  const canModifyCoreSections = canEditShipment && !readOnly
  const canEditAtaQuality =
    canEditShipment &&
    (!readOnly || enableAtaQualityEditInView) &&
    !isCancelledShipment
  const canAddPoOnEdit =
    (canEditShipment || canAddShipment) &&
    !readOnly &&
    Boolean(shipmentId) &&
    editContext?.can_add_po === true

  const applyMasterVessel = useCallback((v: MasterVesselOption) => {
    const charterFromTerms = charterTypeFromMasterTerms(v.terms)
    setVesselName(String(v.vessel_name ?? '').trim())
    setPendingMasterVessel(v)
    setVesselMeta((prev) => ({
      ...prev,
      vessel_code: v.vessel_code ?? '',
      vessel_owner: v.vessel_owner ?? '',
      vessel_capacity: v.vessel_capacity_mt != null ? String(v.vessel_capacity_mt) : prev.vessel_capacity,
      vessel_hull_type: String(v.vessel_type ?? v.hull_type ?? prev.vessel_hull_type ?? ''),
      charter_type: charterFromTerms || prev.charter_type,
    }))
  }, [])

  const vesselOverride = hasKlipVesselNameOverride(vesselName, sapVesselName)
  const vesselMismatch = hasKlipSapMismatch(vesselName, sapVesselName, 'text')

  const planQtyReadOnly = false

  const qtyTableRows: VesselPortsQuantityRow[] = useMemo(
    () =>
      detailRows.map((d) => ({
        rowKey: d.rowKey,
        contract_ext_no: d.contract_number,
        po_number: d.po_number,
        contract_qty: d.contract_qty,
        sto_qty: d.sto_qty_assigned,
        quantity_delivered: d.quantity_delivered_klip,
        quantity_receive: d.quantity_receive_klip,
      })),
    [detailRows],
  )

  const vesselCapacityMt = parseApiNumber(vesselMeta.vessel_capacity)

  const totalShipmentPlanKg = useMemo(() => {
    let sum = 0
    for (const row of detailRows) {
      sum += planQtyEdits[row.rowKey] ?? row.shipment_plan_qty ?? 0
    }
    return sum
  }, [detailRows, planQtyEdits])

  const poTableQtyTotals = useMemo(() => {
    let contractQty = 0
    let sapDelivered = 0
    let sapReceive = 0
    let osQty = 0
    for (const row of detailRows) {
      contractQty += row.contract_qty ?? 0
      sapDelivered += row.quantity_delivered_sap ?? 0
      sapReceive += row.quantity_receive_sap ?? 0
      osQty += row.outstanding_qty_actual ?? 0
    }
    return { contractQty, sapDelivered, sapReceive, osQty }
  }, [detailRows])

  const qtyTotals = useMemo(
    () => sumVesselPortsQuantityEdits(qtyTableRows, qtyEdits),
    [qtyTableRows, qtyEdits],
  )

  const isTcCharter = isTcCharterType(vesselMeta.charter_type)
  const headerVesselOaBudget = parseApiNumber(shipmentInfo.vessel_oa_budget)

  const tcFreightBudgetIdrKg = useMemo(
    () =>
      computeShipmentFreightBudgetIdrKg(
        detailRows.map((d) => ({
          vessel_oa_budget_sap: d.vessel_oa_budget_sap,
          shipment_plan_qty: planQtyEdits[d.rowKey] ?? d.shipment_plan_qty ?? 0,
        })),
        headerVesselOaBudget,
      ),
    [detailRows, planQtyEdits, headerVesselOaBudget],
  )

  const tcR4ShortageMt = useMemo(() => {
    const rows = detailRows.map((d) => {
      const edited = qtyEdits[d.rowKey]
      return {
        quantity_delivered_klip:
          edited?.quantity_delivered !== undefined ? edited.quantity_delivered : d.quantity_delivered_klip,
        quantity_delivered_sap: d.quantity_delivered_sap,
        quantity_receive_klip:
          edited?.quantity_receive !== undefined ? edited.quantity_receive : d.quantity_receive_klip,
        quantity_receive_sap: d.quantity_receive_sap,
      }
    })
    return computeShipmentR4ShortageMt(rows)
  }, [detailRows, qtyEdits])

  const loadingPortRows = useMemo(
    () =>
      loadingPorts
        .filter((p) => !p.is_discharge_port)
        .slice()
        .sort((a, b) => (a.port_sequence ?? 0) - (b.port_sequence ?? 0)),
    [loadingPorts],
  )

  const dischargePortRow = useMemo(
    () => loadingPorts.find((p) => p.is_discharge_port),
    [loadingPorts],
  )

  const etaBlockSnapshots: ShipmentEtaBlockSnapshot[] = useMemo(
    () =>
      etaBlocks.map((block) => ({
        portSequence: block.portSequence,
        status: block.status,
        isDraft: block.isDraft,
        fields: block.fields,
      })),
    [etaBlocks],
  )

  const hasQtyEdits = useMemo(
    () => hasVesselPortsQuantityUserEdits(qtyTableRows, qtyEdits),
    [qtyTableRows, qtyEdits],
  )

  const hasEtaEdits = useMemo(
    () =>
      hasShipmentEtaEdits(etaBaseline, {
        isMultiPortLoading,
        dischargeEta: dischargeEtaFields,
        etaBlocks: etaBlockSnapshots,
      }),
    [etaBaseline, isMultiPortLoading, dischargeEtaFields, etaBlockSnapshots],
  )

  const hasAtaEdits = useMemo(
    () =>
      hasShipmentAtaEdits({
        isMultiPortLoading,
        ataFields,
        originalAtaFields,
        loadingPortAtaByKey,
        originalLoadingPortAtaByKey,
      }),
    [
      isMultiPortLoading,
      ataFields,
      originalAtaFields,
      loadingPortAtaByKey,
      originalLoadingPortAtaByKey,
    ],
  )

  const currentQualityByPortKey = useMemo(
    () => resolveCurrentQualityByPortKey(originalQualityByPortKey, qualityEditsByPortKey),
    [originalQualityByPortKey, qualityEditsByPortKey],
  )

  const hasQualityEdits = useMemo(
    () => hasShipmentQualityEdits(originalQualityByPortKey, currentQualityByPortKey),
    [originalQualityByPortKey, currentQualityByPortKey],
  )

  const hasLimitedEdits = hasAtaEdits || hasQualityEdits

  const requiresEditRemark = hasEtaEdits || hasQtyEdits || hasAtaEdits || hasQualityEdits
  const editRemarkMissing = requiresEditRemark && !editRemark.trim()
  const showSaveButton = canModifyCoreSections || (canEditAtaQuality && hasLimitedEdits)
  const showRemarkField =
    requiresEditRemark && (canModifyCoreSections || canEditAtaQuality)

  const capacityPct =
    vesselCapacityMt != null && vesselCapacityMt > 0
      ? Math.min(100, (totalShipmentPlanKg / 1000 / vesselCapacityMt) * 100)
      : 0

  const resetState = useCallback(() => {
    setShipmentId(null)
    setVesselName('')
    setOriginalVesselName('')
    setSapVesselName('')
    setPendingMasterVessel(null)
    setVesselMeta({})
    setDetailRows([])
    setPlanQtyEdits({})
    setQtyEdits({})
    setSfalQty(null)
    setSfbdQty(null)
    setFuelConsumption(null)
    setFreight(null)
    setPumpRate(null)
    setSailingSpeed(null)
    setOriginalShortage(null)
    setEtaBlocks([])
    setDischargeEtaFields(emptyDischargeEtaFields())
    setEtaSectionEditing(false)
    setIsMultiPortLoading(false)
    setActivityLog([])
    setShipmentRemarks([])
    setShipmentRemarksLoading(false)
    setShipmentInfo({})
    setAtaFields(emptyAtaFields())
    setOriginalAtaFields(emptyAtaFields())
    setAtaSapReference(emptyAtaFields())
    setAtaIsEditing(false)
    setOriginalLoadingPortAtaByKey({})
    setQualityIsEditing(false)
    setShowAtaDifferencesOnly(false)
    setShowQualityDifferencesOnly(false)
    setQualityEditsByPortKey({})
    setOriginalQualityByPortKey({})
    setHasUploadedSld(false)
    setHasUploadedSdd(false)
    setShipmentStatus(null)
    setShipmentDocuments([])
    setDocsLoading(false)
    setEditContext(null)
    setSelectedAddPoOption(null)
    setAddingPo(false)
    setEditRemark('')
    setEtaBaseline(null)
    setPlantSiteName('')
    initSessionRef.current = null
  }, [])

  const hydrateQuantityDocs = useCallback(async (sid: string) => {
    try {
      const params = new URLSearchParams()
      params.append('shipmentId', sid)
      const res = await api.get(`/documents?${params.toString()}`)
      const docs: Array<{ document_type?: string }> = res.data?.data ?? []
      setHasUploadedSld(docs.some((d) => d.document_type === SHIPMENT_SLD_DOC_TYPE))
      setHasUploadedSdd(docs.some((d) => d.document_type === SHIPMENT_SDD_DOC_TYPE))
    } catch {
      // non-blocking
    }
  }, [])

  const loadShipmentDocuments = useCallback(async (sid: string) => {
    setDocsLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('shipmentId', sid)
      const res = await api.get(`/documents?${params.toString()}`)
      setShipmentDocuments(res.data?.data ?? [])
    } catch {
      setShipmentDocuments([])
    } finally {
      setDocsLoading(false)
    }
  }, [])

  const handleDownloadDocument = useCallback(async (docId: string, fileName: string) => {
    try {
      const response = await api.get(`/documents/${docId}/download`, { responseType: 'blob' })
      const blob = new Blob([response.data])
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch {
      setNotification({ type: 'error', message: 'Failed to download document. Please try again.' })
    }
  }, [])

  const loadActivityLog = useCallback(async (sid: string) => {
    setActivityLoading(true)
    try {
      const res = await api.get(`/shipments/${sid}/activity-log`)
      setActivityLog(res.data?.data ?? [])
    } catch {
      setActivityLog([])
    } finally {
      setActivityLoading(false)
    }
  }, [])

  const loadShipmentRemarks = useCallback(async (sid: string) => {
    setShipmentRemarksLoading(true)
    try {
      const res = await api.get(`/shipments/${sid}/remarks`)
      setShipmentRemarks(Array.isArray(res.data?.data) ? res.data.data : [])
    } catch {
      setShipmentRemarks([])
    } finally {
      setShipmentRemarksLoading(false)
    }
  }, [])

  const loadShipment = useCallback(
    async (
      contractId: string,
      directShipmentId?: string | null,
      preferredStoNumber?: string | null,
    ) => {
      setLoading(true)
      setShipmentId(null)
      try {
        let sid = directShipmentId?.trim() || ''
        if (!sid) {
          const listRes = await api.get('/shipments', {
            params: { contract: contractId, limit: 100, page: 1, compact: 'true' },
          })
          const shipments: Array<Record<string, unknown>> = listRes.data?.data?.shipments ?? []
          const first = shipments[0]
          if (!first?.id) throw new Error('No shipment found for this contract')
          sid = String(first.id)
        }

        const payloadRes = await api.get(`/shipments/${sid}/edit-payload`, {
          params: preferredStoNumber?.trim() ? { sto: preferredStoNumber.trim() } : undefined,
        })
        const payload = payloadRes.data?.data as {
          shipment?: Record<string, unknown>
          editContext?: ShipmentEditContextData | null
          ports?: LoadingPortRef[]
          shipmentInfo?: Record<string, unknown> | null
          contractDetails?: Array<Record<string, unknown>>
        } | null
        if (!payload?.shipment) throw new Error('Failed to load shipment')

        const row = { ...payload.shipment, id: sid } as Record<string, unknown>
        const editContext = payload.editContext ?? null
        const ports: LoadingPortRef[] = payload.ports ?? []
        const info: Record<string, unknown> = payload.shipmentInfo ?? {}

        setShipmentId(sid)

        const contractNumbers = mergeContractNumberLists(
          editContractNumbers,
          editContext?.contract_numbers,
          row.contract_numbers as string | undefined,
          row.contract_number as string | undefined,
          contractId,
        )

        setShipmentStatus(String(row.status ?? info.status ?? '').trim() || null)
        setLoadingPorts(ports)
        setShipmentInfo(info)
        const loadedAta = ataFieldsFromShipmentInfo(info)
        setAtaFields(loadedAta)
        setOriginalAtaFields(loadedAta)
        setAtaSapReference(ataSapReferenceFromShipmentInfo(info))
        setAtaIsEditing(false)

        setEditContext(editContext)
        setSelectedAddPoOption(null)

        // Display the list STO (preferredStoNumber = row sto_key). Payload also receives
        // that STO so SAP delivered/receive/OS are scoped to the Type V sea leg, not the
        // Type T shipment_id sibling on FOB mixed POs.
        const preferredDisplaySto = resolveShipmentDisplayStoNumber(preferredStoNumber)
        const displaySto =
          preferredDisplaySto !== '-'
            ? preferredDisplaySto
            : resolveShipmentDisplayStoNumber(row.contract_sto_number ?? row.sto_number)

        const detailsData = Array.isArray(payload.contractDetails) ? payload.contractDetails : []
        let contractDetails = await buildContractDetailRows(
          detailsData,
          sid,
          contractNumbers,
        )

        const hasPerPoKlip = contractDetails.some(
          (r) => r.quantity_delivered_klip != null || r.quantity_receive_klip != null,
        )
        const shipmentDeliveredKlipKg = shipmentStoredQtyKg(parseApiNumber(info.quantity_delivered_klip))
        const shipmentDeliveredKg = shipmentStoredQtyKg(parseApiNumber(info.quantity_delivered))
        const shipmentReceiveKg = shipmentStoredQtyKg(parseApiNumber(info.actual_vessel_qty_receive))
        if (!hasPerPoKlip) {
          // Legacy: header-only KLIP sum (pre per-PO persist) — redistribute for display.
          const klipSeeded = seedKlipQtyFromShipmentHeader(
            contractDetails.map((r) => ({
              quantity_delivered: r.quantity_delivered_sap,
              quantity_receive: r.quantity_receive_sap,
            })),
            {
              shipmentDeliveredKlipKg,
              shipmentDeliveredKg,
              shipmentReceiveKg,
            },
          )
          contractDetails = contractDetails.map((row, i) => ({
            ...row,
            quantity_delivered_klip: klipSeeded[i]?.quantity_delivered ?? null,
            quantity_receive_klip: klipSeeded[i]?.quantity_receive ?? null,
          }))
        }

        setDetailRows(contractDetails)
        setPlanQtyEdits(
          Object.fromEntries(
            contractDetails.map((detailRow) => [detailRow.rowKey, detailRow.shipment_plan_qty ?? 0]),
          ),
        )
        setQtyEdits({})

        const klipVn = String(row.vessel_name_klip ?? row.vessel_name ?? '').trim()
        const sapVn = String(row.vessel_name_sap ?? '').trim()
        const primaryVn = shipmentVesselPrimaryName(klipVn, sapVn)
        setSapVesselName(sapVn)
        setVesselName(primaryVn)
        setOriginalVesselName(primaryVn)
        setPendingMasterVessel(null)
        setVesselMeta({
          vessel_code: String(row.vessel_code ?? ''),
          vessel_owner: String(row.vessel_owner ?? ''),
          vessel_capacity: String(row.vessel_capacity ?? ''),
          vessel_draft: String(row.vessel_draft ?? ''),
          vessel_hull_type: String(row.vessel_hull_type ?? ''),
          charter_type: String(row.charter_type ?? ''),
          port_of_discharge: String(row.port_of_discharge ?? info.vessel_discharge_port_1 ?? ''),
        })
        setOperationId(String(row.operation_id ?? ''))
        setStoNumber(displaySto === '-' ? '' : displaySto)

        const loadingPortRows = ports
          .filter((p) => !p.is_discharge_port)
          .slice()
          .sort((a, b) => (a.port_sequence ?? 0) - (b.port_sequence ?? 0))

        const polKlip =
          resolveKlipPortInputValue(loadingPortRows[0]?.port_name) ||
          resolveKlipPortInputValue(info.vessel_loading_port_1) ||
          resolveKlipPortInputValue(row.port_of_loading)
        const podKlip =
          resolveKlipPortInputValue(info.vessel_discharge_port_1) ||
          resolveKlipPortInputValue(row.port_of_discharge)
        setLoadingPort(polKlip)
        setDischargePort(podKlip)

        const sfal = parseApiNumber(info.sfal_qty ?? row.sfal_qty)
        const sfbd = parseApiNumber(info.sfbd_qty ?? row.sfbd_qty)
        setSfalQty(sfal)
        setSfbdQty(sfbd)
        setOriginalSfalQty(sfal)
        setOriginalSfbdQty(sfbd)

        const fuelConsumptionVal = parseApiNumber(info.fuel_consumption ?? row.fuel_consumption)
        const freightVal = parseApiNumber(info.freight ?? row.freight)
        const pumpRateVal = parseApiNumber(info.pump_rate ?? row.pump_rate)
        const sailingSpeedVal = parseApiNumber(info.sailing_speed ?? row.sailing_speed)
        const shortageVal = parseApiNumber(info.shortage ?? row.shortage)
        setFuelConsumption(fuelConsumptionVal)
        setFreight(freightVal)
        setPumpRate(pumpRateVal)
        setSailingSpeed(sailingSpeedVal)
        setOriginalFuelConsumption(fuelConsumptionVal)
        setOriginalFreight(freightVal)
        setOriginalPumpRate(pumpRateVal)
        setOriginalSailingSpeed(sailingSpeedVal)
        setOriginalShortage(shortageVal)

        const deliveredKg =
          contractDetails.reduce((s, r) => s + (r.quantity_delivered_klip ?? 0), 0)
          || shipmentDeliveredKlipKg
          || shipmentDeliveredKg
        const receiveKg =
          contractDetails.reduce((s, r) => s + (r.quantity_receive_klip ?? 0), 0)
          || shipmentReceiveKg
        setOriginalDeliveredKg(deliveredKg)
        setOriginalReceiveKg(receiveKg)

        const dischargeEta = dischargeEtaFromInfo(info, row)
        setDischargeEtaFields(dischargeEta)

        const poLabels = contractDetails.map((d) => d.po_number || d.contract_number).filter(Boolean)
        const multiPort = loadingPortRows.length > 1
        setIsMultiPortLoading(multiPort)
        setEtaSectionEditing(false)

        if (multiPort) {
          // Multi-contract STO group: each loading port belongs to one contract's shipment
          // row — label it with that contract's PO(s) rather than the whole group's list.
          const labelsByContract = new Map<string, string[]>()
          for (const d of contractDetails) {
            const cn = String(d.contract_number ?? '').trim()
            if (!cn) continue
            const label = d.po_number || d.contract_number
            if (!label) continue
            labelsByContract.set(cn, [...(labelsByContract.get(cn) ?? []), label])
          }
          // `info`/`row` are shipment-level fields scoped to the anchor shipment (sid) only —
          // they must not leak into other ports' blocks, or every port with no data of its
          // own on `vessel_loading_ports` would incorrectly display the anchor's dates.
          const portBelongsToAnchor = (p: LoadingPortRef) =>
            Boolean(p.shipment_id) && String(p.shipment_id) === sid
          const blocks: EtaBlock[] = loadingPortRows.map((portRow) => {
            const portContract = String(portRow.contract_number ?? '').trim()
            const contractLabels =
              (portContract && labelsByContract.get(portContract)) || poLabels
            const isAnchorPort = portBelongsToAnchor(portRow)
            return {
              id: portRow.id || `port-${portRow.port_sequence ?? 1}`,
              portId: portRow.id,
              portSequence: portRow.port_sequence ?? 1,
              status: 'active' as const,
              loadingPort: resolveKlipPortInputValue(portRow.port_name),
              contractLabels,
              fields: loadingEtaFromPortRow(portRow, isAnchorPort ? info : {}, isAnchorPort ? row : {}),
              isEditing: false,
            }
          })
          setEtaBlocks(blocks)
          const ataByKey: Record<string, LoadingAtaFields> = {}
          for (const portRow of loadingPortRows) {
            ataByKey[loadingPortAtaStateKey(portRow)] = loadingAtaFromPortRow(
              portRow,
              portBelongsToAnchor(portRow) ? info : {},
            )
          }
          setLoadingPortAtaByKey(ataByKey)
          setOriginalLoadingPortAtaByKey({ ...ataByKey })
          setEtaBaseline(
            buildShipmentEtaBaseline({
              isMultiPortLoading: true,
              dischargeEta,
              etaBlocks: blocks,
            }),
          )
        } else {
          setLoadingPortAtaByKey({})
          setOriginalLoadingPortAtaByKey({})
          const loadingPortRow = loadingPortRows[0]

          const etaFields: EditEtaFields = {
            ...loadingEtaFromPortRow(loadingPortRow, info, row),
            ...dischargeEta,
          }

          const blocks: EtaBlock[] = [
            {
              id: `eta-active-${Date.now()}`,
              portId: loadingPortRow?.id,
              portSequence: loadingPortRow?.port_sequence ?? 1,
              status: 'active',
              loadingPort: polKlip,
              contractLabels: poLabels,
              fields: etaFields,
              isEditing: false,
            },
          ]
          setEtaBlocks(blocks)
          setEtaBaseline(
            buildShipmentEtaBaseline({
              isMultiPortLoading: false,
              dischargeEta,
              etaBlocks: blocks,
            }),
          )
        }
        const dischargePortForQuality = ports.find((p) => p.is_discharge_port)
        setOriginalQualityByPortKey(
          buildQualityBaselineFromPorts(loadingPortRows, dischargePortForQuality, info, sid),
        )
        setQualityEditsByPortKey({})
        setQualityIsEditing(false)
        setAtaIsEditing(false)
        setEditRemark('')

        const plantCode = String(row.plant_code ?? '').trim()
        const groupPlant = String(row.plant_site ?? '').trim()
        if (groupPlant && groupPlant !== 'Blank') {
          setPlantSiteName(groupPlant)
        } else if (plantCode) {
          setPlantSiteName(plantCode)
          void api
            .get('/master-plants', { params: { search: plantCode, limit: 20 } })
            .then((plantsRes) => {
              const items: Array<{ plant_code?: string; plant_name?: string; group_plant?: string }> =
                plantsRes?.data?.data?.items ?? []
              const match = items.find(
                (p) => String(p.plant_code ?? '').trim().toUpperCase() === plantCode.toUpperCase(),
              )
              const resolved =
                match?.group_plant?.trim() || match?.plant_name?.trim() || ''
              if (resolved) setPlantSiteName(resolved)
            })
            .catch(() => {})
        } else {
          setPlantSiteName('')
        }

        void (async () => {
          if (readOnly) {
            await loadShipmentDocuments(sid)
          } else {
            await hydrateQuantityDocs(sid)
          }
          void loadActivityLog(sid)
          void loadShipmentRemarks(sid)
        })()
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to load shipment'
        setNotification({ type: 'error', message: msg })
      } finally {
        setLoading(false)
      }
    },
    [hydrateQuantityDocs, loadActivityLog, loadShipmentRemarks, loadShipmentDocuments, editContractNumbers, readOnly],
  )

  const handleAddPo = useCallback(async () => {
    if (!shipmentId || !selectedAddPoOption) {
      setNotification({ type: 'error', message: 'Select a PO to add.' })
      return
    }

    setAddingPo(true)
    setNotification(null)
    try {
      await attachPurchaseOrderToShipment({
        shipmentId,
        contractRowId: selectedAddPoOption.key,
        stoQtyAssignedKg: 0,
      })
      setNotification({ type: 'success', message: 'PO added — set Shipment Plan Qty and save changes.' })
      const contractId = editContractId?.trim()
      const directId = editShipmentIdProp?.trim()
      const sto = editStoNumber?.trim()
      if (directId) {
        await loadShipment(contractId || directId, directId, sto)
      } else if (contractId) {
        await loadShipment(contractId, null, sto)
      }
      onShipmentChanged?.()
    } catch (error: unknown) {
      const axiosErr = error as {
        response?: { data?: { error?: { message?: string } } }
        message?: string
      }
      const msg =
        axiosErr.response?.data?.error?.message || axiosErr.message || 'Failed to add PO to shipment'
      setNotification({ type: 'error', message: msg })
    } finally {
      setAddingPo(false)
    }
  }, [
    editContractId,
    editShipmentIdProp,
    editStoNumber,
    loadShipment,
    onShipmentChanged,
    selectedAddPoOption,
    shipmentId,
  ])

  useEffect(() => {
    if (!open) {
      initSessionRef.current = null
      return
    }
    const sessionKey = `${editContractId ?? ''}:${editShipmentIdProp ?? ''}:${editStoNumber ?? ''}:${editContractNumbers ?? ''}`
    if (initSessionRef.current === sessionKey) return
    initSessionRef.current = sessionKey
    resetState()
    const contractId = editContractId?.trim()
    const directId = editShipmentIdProp?.trim()
    const sto = editStoNumber?.trim()
    if (directId) {
      void loadShipment(contractId || directId, directId, sto)
    } else if (contractId) {
      void loadShipment(contractId, null, sto)
    }
  }, [open, editContractId, editShipmentIdProp, editStoNumber, editContractNumbers, loadShipment, resetState])

  const handleQtyDocUpload = async (
    kind: typeof SHIPMENT_SLD_DOC_TYPE | typeof SHIPMENT_SDD_DOC_TYPE,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    if (!file || !shipmentId) return
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      alert('Only PDF files are allowed.')
      e.target.value = ''
      return
    }
    const isSld = kind === SHIPMENT_SLD_DOC_TYPE
    if ((isSld && hasUploadedSld) || (!isSld && hasUploadedSdd)) return
    const setUploading = isSld ? setSldDocUploading : setSddDocUploading
    const setUploaded = isSld ? setHasUploadedSld : setHasUploadedSdd
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('document_type', kind)
      form.append('shipment_id', shipmentId)
      form.append('description', `${kind} document for quantity authorization`)
      const res = await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (res.data?.success) setUploaded(true)
      else alert(res.data?.error?.message || 'Upload failed')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      alert(msg)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const resolveRowQty = (
    row: VesselPortsQuantityRow,
    field: 'quantity_delivered' | 'quantity_receive',
  ): number | null => {
    const edited = qtyEdits[row.rowKey]?.[field]
    if (edited !== undefined) return edited
    return row[field] ?? null
  }

  const handleSave = async () => {
    if (!shipmentId) return
    if (perms.loaded && !canEditShipment) {
      setNotification({ type: 'error', message: 'You need Edit permission on Shipments.' })
      return
    }

    const isLimitedViewSave = readOnly && enableAtaQualityEditInView

    if (isLimitedViewSave && !hasLimitedEdits) {
      setNotification({ type: 'error', message: 'No ATA or Quality changes to save.' })
      return
    }

    let saveActiveEta: EditEtaFields | null = null
    if (!isLimitedViewSave) {
      const activeBlock = isMultiPortLoading
        ? etaBlocks.find((b) => b.portSequence === 1) ?? etaBlocks[0]
        : etaBlocks.find((b) => b.status === 'active')
      if (!activeBlock) {
        setNotification({ type: 'error', message: 'No active Estimation block to save.' })
        return
      }

      saveActiveEta = isMultiPortLoading
        ? {
            ...activeBlock.fields,
            ...dischargeEtaFields,
          }
        : activeBlock.fields
    }

    if (requiresEditRemark && !editRemark.trim()) {
      setNotification({
        type: 'error',
        message:
          'Remark is required when editing Estimation, quantities, ATA, or Quality.',
      })
      return
    }

    setSaving(true)
    setNotification(null)
    try {
      if (!isLimitedViewSave && !planQtyReadOnly && detailRows.length > 0) {
        const overOs = detailRows.find((row) => {
          const planKg = planQtyEdits[row.rowKey] ?? row.shipment_plan_qty ?? 0
          return shipmentPlanQtyExceedsOsActual(planKg, row.outstanding_qty_actual)
        })
        if (overOs) {
          setSaving(false)
          setNotification({
            type: 'error',
            message: `Shipment Plan Qty for ${overOs.contract_number} exceeds OS Qty (Actual)`,
          })
          return
        }
        await batchSaveShipmentPoPlanQty({
          shipmentId,
          rows: detailRows.map((row) => ({
            contractNumber: row.contract_number,
            poNumber: row.po_number || null,
            shipmentPlanQtyKg: planQtyEdits[row.rowKey] ?? row.shipment_plan_qty ?? 0,
          })),
        })
      }

      const qtyUserEdited = hasVesselPortsQuantityUserEdits(qtyTableRows, qtyEdits)
      await saveEditShipmentChanges({
        shipmentId,
        vesselName,
        originalVesselName,
        vesselCode: vesselMeta.vessel_code,
        vesselOwner: vesselMeta.vessel_owner,
        vesselCapacity: vesselMeta.vessel_capacity,
        vesselHullType: vesselMeta.vessel_hull_type,
        charterType: vesselMeta.charter_type,
        masterVesselId: pendingMasterVessel?.id ?? null,
        sfalQty,
        sfbdQty,
        originalSfalQty,
        originalSfbdQty,
        fuelConsumption,
        freight,
        pumpRate,
        sailingSpeed,
        autoPersistShortageMt: isTcCharter ? tcR4ShortageMt : undefined,
        originalFuelConsumption,
        originalFreight,
        originalPumpRate,
        originalSailingSpeed,
        originalShortage,
        loadingPort,
        dischargePort,
        activeEta: saveActiveEta ?? emptyEtaFields(),
        isMultiPortLoading,
        loadingPortEtas: isMultiPortLoading
          ? etaBlocks.map((block) => ({
              portId: block.portId,
              portSequence: block.portSequence,
              portName: block.loadingPort,
              fields: {
                etaVesselArrivalAtLoadingPort: block.fields.etaVesselArrivalAtLoadingPort,
                etaVesselBerthedAtLoadingPort: block.fields.etaVesselBerthedAtLoadingPort,
                etaVesselStartLoading: block.fields.etaVesselStartLoading,
                etaVesselCompletedLoading: block.fields.etaVesselCompletedLoading,
                etaVesselSailedFromLoadingPort: block.fields.etaVesselSailedFromLoadingPort,
              },
            }))
          : undefined,
        dischargeEta: isMultiPortLoading ? dischargeEtaFields : undefined,
        qtyRows: qtyTableRows,
        qtyEdits,
        originalDeliveredKg,
        originalReceiveKg,
        quantityUnlocked: isQuantityUnlocked,
        hasSldOrSddDoc: hasUploadedSld || hasUploadedSdd,
        loadingPorts,
        ataFields,
        originalAtaFields,
        loadingPortAtas: isMultiPortLoading
          ? loadingPortRows.map((portRow) => {
              const ataKey = loadingPortAtaStateKey(portRow)
              return {
                portId: portRow.id,
                portSequence: portRow.port_sequence ?? 1,
                fields:
                  loadingPortAtaByKey[ataKey] ??
                  loadingAtaFromPortRow(
                    portRow,
                    portRow.shipment_id && String(portRow.shipment_id) === shipmentId
                      ? shipmentInfo
                      : {},
                  ),
              }
            })
          : undefined,
        qualityByPortKey: currentQualityByPortKey,
        originalQualityByPortKey,
        ataQualityOnly: isLimitedViewSave,
      })

      if (requiresEditRemark) {
        await saveShipmentEditRemark(shipmentId, editRemark)
      }

      if (isLimitedViewSave) {
        setNotification({ type: 'success', message: 'ATA and Quality updated successfully.' })
        setAtaIsEditing(false)
        setQualityIsEditing(false)
        setEditRemark('')
        const contractId = editContractId?.trim()
        const directId = editShipmentIdProp?.trim()
        const sto = editStoNumber?.trim()
        if (directId) {
          await loadShipment(contractId || directId, directId, sto)
        } else if (contractId) {
          await loadShipment(contractId, null, sto)
        }
        void loadActivityLog(shipmentId)
        void loadShipmentRemarks(shipmentId)
        onShipmentChanged?.()
        return
      }

      await onSubmit({
        kind: 'update',
        shipmentId,
        vessel_name: vesselName.trim() !== originalVesselName.trim() ? vesselName.trim() : undefined,
        ...(vesselName.trim() !== originalVesselName.trim()
          ? {
              vessel_code: vesselMeta.vessel_code || undefined,
              vessel_owner: vesselMeta.vessel_owner || undefined,
              vessel_capacity: vesselMeta.vessel_capacity || undefined,
              vessel_hull_type: vesselMeta.vessel_hull_type || undefined,
              charter_type: vesselMeta.charter_type || undefined,
              master_vessel_id: pendingMasterVessel?.id ?? undefined,
            }
          : {}),
        ...(qtyUserEdited && qtyTotals.quantity_delivered !== null
          ? { quantity_delivered: qtyTotals.quantity_delivered }
          : {}),
        ...(qtyUserEdited && qtyTotals.quantity_receive !== null
          ? { actual_vessel_qty_receive: qtyTotals.quantity_receive }
          : {}),
        sfal_qty: sfalQty,
        sfbd_qty: sfbdQty,
        fuel_consumption: fuelConsumption,
        freight,
        pump_rate: pumpRate,
        sailing_speed: sailingSpeed,
        ...(isTcCharter ? { shortage: tcR4ShortageMt } : {}),
        eta_arrival: toApiDateOnly(saveActiveEta!.etaVesselArrivalAtLoadingPort),
        eta_berthed: toApiDateOnly(saveActiveEta!.etaVesselBerthedAtLoadingPort),
        eta_loading_start: toApiDateOnly(saveActiveEta!.etaVesselStartLoading),
        eta_loading_complete: toApiDateOnly(saveActiveEta!.etaVesselCompletedLoading),
        eta_sailed: toApiDateOnly(saveActiveEta!.etaVesselSailedFromLoadingPort),
        eta_discharge_arrival: toApiDateOnly(saveActiveEta!.etaVesselArriveAtDischargePort),
        eta_discharge_berthed: toApiDateOnly(saveActiveEta!.etaVesselBerthedAtDischargePort),
        eta_discharge_start: toApiDateOnly(saveActiveEta!.etaVesselStartDischarging),
        eta_discharge_complete: toApiDateOnly(saveActiveEta!.etaVesselCompleteDischarge),
      })

      setNotification({ type: 'success', message: 'Shipment updated successfully.' })
      invalidateMissingEtaAlertCache()
      onShipmentChanged?.()
      onClose()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save shipment'
      setNotification({ type: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  const handleAddEta = () => {
    if (isMultiPortLoading) return
    setEtaBlocks((prev) => {
      const active = prev.find((b) => b.status === 'active')
      if (!active || active.isDraft) return prev
      const historical = { ...active, status: 'historical' as const, isEditing: false, isDraft: false }
      const newActive: EtaBlock = {
        id: `eta-${Date.now()}`,
        portId: active.portId,
        portSequence: active.portSequence,
        status: 'active',
        loadingPort: active.loadingPort,
        contractLabels: [...active.contractLabels],
        fields: emptyEtaFields(),
        isEditing: true,
        isDraft: true,
      }
      return [...prev.filter((b) => b.id !== active.id), historical, newActive]
    })
  }

  const handleCancelAddEta = () => {
    setEtaBlocks((prev) => {
      const draft = prev.find((b) => b.status === 'active' && b.isDraft)
      if (!draft) return prev
      const withoutDraft = prev.filter((b) => b.id !== draft.id)
      const promotedHistorical = [...withoutDraft]
        .reverse()
        .find((b) => b.status === 'historical')
      if (!promotedHistorical) return withoutDraft
      const restored: EtaBlock = {
        ...promotedHistorical,
        status: 'active',
        isEditing: false,
        isDraft: false,
      }
      return [
        ...withoutDraft.filter((b) => b.id !== promotedHistorical.id),
        restored,
      ]
    })
  }

  const handleCancelEtaEdit = () => {
    if (isMultiPortLoading) {
      if (etaBaseline) {
        setDischargeEtaFields({ ...etaBaseline.dischargeEta })
        setEtaBlocks((prev) =>
          prev.map((block) => {
            const baselinePort = etaBaseline.loadingPorts.find(
              (p) => p.portSequence === block.portSequence,
            )
            if (!baselinePort || block.status !== 'active') {
              return { ...block, isEditing: false }
            }
            return {
              ...block,
              isEditing: false,
              fields: {
                ...block.fields,
                ...baselinePort.fields,
              },
            }
          }),
        )
      }
      setEtaSectionEditing(false)
      return
    }

    const draft = etaBlocks.find((b) => b.status === 'active' && b.isDraft)
    if (draft) {
      handleCancelAddEta()
      return
    }

    if (!etaBaseline?.singlePortActiveEta) {
      setEtaBlocks((prev) =>
        prev.map((b) => (b.status === 'active' ? { ...b, isEditing: false } : b)),
      )
      return
    }

    setEtaBlocks((prev) =>
      prev.map((b) =>
        b.status === 'active'
          ? { ...b, isEditing: false, fields: { ...etaBaseline.singlePortActiveEta! } }
          : b,
      ),
    )
  }

  const handleCancelAtaEdit = () => {
    setAtaFields({ ...originalAtaFields })
    setLoadingPortAtaByKey({ ...originalLoadingPortAtaByKey })
    setAtaIsEditing(false)
  }

  const handleCancelQualityEdit = () => {
    setQualityEditsByPortKey({})
    setQualityIsEditing(false)
  }

  const qualityFieldsForPortKey = (portKey: string): ShipmentQualityFields =>
    currentQualityByPortKey[portKey] ??
    originalQualityByPortKey[portKey] ??
    emptyShipmentQualityFields()

  const resolveAtaSapReference = (
    key: ShipmentAtaApiField,
    portRow?: LoadingPortRef,
  ): string => {
    if (key.includes('discharg')) {
      return ataSapReference[key] ?? ''
    }
    const portSap = loadingAtaSapFromPortRow(portRow as Record<string, unknown> | undefined)
    const fromPort = portSap[key as keyof typeof portSap]
    if (fromPort) return fromPort
    return ataSapReference[key] ?? ''
  }

  const updateQualityField = (
    portKey: string,
    fieldKey: keyof ShipmentQualityFields,
    raw: string,
  ) => {
    setQualityEditsByPortKey((prev) => {
      const baseline = originalQualityByPortKey[portKey] ?? emptyShipmentQualityFields()
      const current = prev[portKey] ?? baseline
      const trimmed = raw.trim()
      let nextValue: number | null
      if (!trimmed) {
        nextValue = null
      } else {
        const parsed = parseFloat(trimmed.replace(/,/g, ''))
        nextValue = Number.isFinite(parsed) ? parsed : current[fieldKey]
      }
      return {
        ...prev,
        [portKey]: { ...current, [fieldKey]: nextValue },
      }
    })
  }

  const updateActiveEtaField = (key: keyof EditEtaFields, value: string) => {
    setEtaBlocks((prev) =>
      prev.map((b) =>
        b.status === 'active' ? { ...b, fields: { ...b.fields, [key]: value } } : b,
      ),
    )
  }

  const updateMultiPortEtaField = (blockId: string, key: keyof EditEtaFields, value: string) => {
    setEtaBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, fields: { ...b.fields, [key]: value } } : b)),
    )
  }

  const updateDischargeEtaField = (key: keyof DischargeEtaFields, value: string) => {
    setDischargeEtaFields((prev) => ({ ...prev, [key]: value }))
  }

  const openContractDetailFromPoRow = async (row: ShipmentDetailRow) => {
    const po = String(row.po_number || '').trim()
    const contractNumber = String(row.contract_number || '').trim()
    if (!po && !contractNumber) return
    setContractDetailLoading(true)
    try {
      const contract = await fetchContractForDetailModalByPo(po || contractNumber, contractNumber)
      if (contract) {
        setContractDetailTarget(contract)
      } else {
        setNotification({
          type: 'error',
          message: 'Contract details not found for this PO.',
        })
      }
    } finally {
      setContractDetailLoading(false)
    }
  }

  if (!open) return null

  const activeEtaBlock = etaBlocks.find((b) => b.status === 'active')
  const historicalEtaBlocks = etaBlocks.filter((b) => b.status === 'historical')
  const etaSectionIsEditing = isMultiPortLoading
    ? etaSectionEditing
    : Boolean(activeEtaBlock?.isEditing || activeEtaBlock?.isDraft)

  const step1Done = Boolean(vesselName.trim())
  const step2Done = detailRows.length > 0 || Boolean(stoNumber.trim())
  const step3Done = Boolean(
    activeEtaBlock &&
      Object.values(activeEtaBlock.fields).some((v) => String(v ?? '').trim() !== ''),
  )
  const step4Done = Object.values(ataFields).some((v) => String(v ?? '').trim() !== '')
  const step5Done = loadingPortRows.length > 0

  return (
    <>
    <div
      className={
        stacked
          ? 'fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4'
          : VESSEL_MODAL_OVERLAY_CLASS
      }
    >
      <div className={VESSEL_MODAL_PANEL_CLASS}>
        <div className={VESSEL_MODAL_HEADER_CLASS}>
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white">
                <Ship className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {readOnly ? 'View Shipment' : 'Edit Shipment'}
                  </h3>
                  {readOnly && (
                    <Badge className={shipmentStatusBadgeClass(shipmentStatus)}>
                      {formatShipmentStatusLabel(shipmentStatus)}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {readOnly
                    ? stoNumber
                      ? `STO ${stoNumber} — read-only shipment execution details`
                      : 'Read-only view of shipment execution details'
                    : stoNumber
                      ? `STO ${stoNumber} — edit Estimation schedule and manual ATA (SAP reference preserved)`
                      : 'Update vessel, quantities, Estimation schedule, and manual ATA'}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-gray-600" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className={VESSEL_MODAL_STEP_STRIP_CLASS}>
            {[
              { num: 1, label: 'Vessel', done: step1Done },
              { num: 2, label: 'Shipment Detail', done: step2Done },
              { num: 3, label: 'Estimation', done: step3Done },
              { num: 4, label: 'ATA', done: step4Done },
              { num: 5, label: 'Quality', done: step5Done },
            ].map((step, i, arr) => (
              <div key={step.num} className="flex items-center">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                      step.done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {step.done ? <Check className="h-3.5 w-3.5" /> : step.num}
                  </div>
                  <span className={`text-xs font-medium ${step.done ? 'text-green-700' : 'text-gray-500'}`}>
                    {step.label}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <ChevronRight className="mx-3 h-3.5 w-3.5 shrink-0 text-gray-300" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={VESSEL_MODAL_BODY_CLASS}>
          {loading && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading shipment details…
            </div>
          )}

          {notification && (
            <div
              className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                notification.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {notification.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <p>{notification.message}</p>
            </div>
          )}

          <div className="space-y-5">
            {/* Section 1: Vessel Detail */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={vesselModalSectionHeaderClass('cyan')}>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-100">
                  <Anchor className="h-3.5 w-3.5 text-cyan-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">1. Vessel Detail</h4>
                {step1Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
              </div>
              <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
                <div
                  className={cn(
                    'md:col-span-2 lg:col-span-3',
                    vesselMismatch && 'border-l-2 border-amber-400 pl-2',
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <label className="block text-xs font-medium text-gray-600">Vessel Name</label>
                    {sapVesselName ? <KlipSapCompareLegend className="ml-auto" /> : null}
                  </div>
                  {canModifyCoreSections ? (
                    <MasterVesselCombobox
                      value={vesselName}
                      onSelect={applyMasterVessel}
                      placeholder="Search and select from Master Vessel"
                    />
                  ) : (
                    <div className="flex min-h-8 items-center gap-2 text-sm font-medium text-gray-900">
                      <span>{formatInfoDisplayValue(vesselName)}</span>
                      {vesselOverride ? (
                        <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700">
                          KLIP
                        </span>
                      ) : sapVesselName ? (
                        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600">
                          SAP
                        </span>
                      ) : null}
                    </div>
                  )}
                  {canModifyCoreSections && vesselOverride ? (
                    <span className="mt-1 inline-flex rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700">
                      KLIP
                    </span>
                  ) : null}
                  {canModifyCoreSections && !vesselOverride && sapVesselName ? (
                    <span className="mt-1 inline-flex rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600">
                      SAP
                    </span>
                  ) : null}
                  {vesselOverride && sapVesselName ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
                      <span>SAP {sapVesselName}</span>
                      <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">
                        SAP
                      </span>
                    </div>
                  ) : null}
                </div>
                {[
                  ['Vessel Code', formatVesselCodeDisplay(vesselMeta.vessel_code)],
                  ['Vessel Owner', vesselMeta.vessel_owner],
                  ['Vessel Capacity (MT)', vesselMeta.vessel_capacity],
                  ['Vessel Draft', vesselMeta.vessel_draft],
                  ['Vessel Type', vesselMeta.vessel_hull_type],
                  ['Charter Type', vesselMeta.charter_type],
                  [
                    'Discharge Port',
                    resolveLoadingPortDisplayFromRow(
                      dischargePortRow ?? {
                        is_discharge_port: true,
                        port_name: vesselMeta.port_of_discharge,
                      },
                      shipmentInfo,
                    ),
                  ],
                  ['Plant / Site', plantSiteName],
                ].map(([label, value]) => (
                  <ReadOnlyInfoField key={String(label)} label={String(label)} value={value} />
                ))}
              </div>

              {isTcCharter && (
                <div className="border-t border-gray-100 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-cyan-600" />
                    <h5 className="text-sm font-semibold text-gray-800">
                      {TC_VESSEL_PERF_LABELS.sectionTitle}
                    </h5>
                  </div>
                  {canModifyCoreSections ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          {TC_VESSEL_PERF_LABELS.fuelConsumptionKl}
                        </label>
                        <MetricDecimalInput value={fuelConsumption} onChange={setFuelConsumption} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          {TC_VESSEL_PERF_LABELS.freightActualIdrKg}
                        </label>
                        <MetricDecimalInput value={freight} onChange={setFreight} />
                      </div>
                      <ReadOnlyInfoField
                        label={TC_VESSEL_PERF_LABELS.freightBudgetIdrKg}
                        value={formatMetricReadOnly(tcFreightBudgetIdrKg)}
                      />
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          {TC_VESSEL_PERF_LABELS.pumpRateMtH}
                        </label>
                        <MetricDecimalInput value={pumpRate} onChange={setPumpRate} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          {TC_VESSEL_PERF_LABELS.sailingSpeed}
                        </label>
                        <MetricDecimalInput value={sailingSpeed} onChange={setSailingSpeed} />
                      </div>
                      <ReadOnlyInfoField
                        label={TC_VESSEL_PERF_LABELS.shortageMt}
                        value={formatMetricReadOnly(tcR4ShortageMt)}
                        helpText={TC_VESSEL_PERF_TOOLTIPS.shortageMt}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <ReadOnlyInfoField
                        label={TC_VESSEL_PERF_LABELS.fuelConsumptionKl}
                        value={formatMetricReadOnly(fuelConsumption)}
                      />
                      <ReadOnlyInfoField
                        label={TC_VESSEL_PERF_LABELS.freightActualIdrKg}
                        value={formatMetricReadOnly(freight)}
                      />
                      <ReadOnlyInfoField
                        label={TC_VESSEL_PERF_LABELS.freightBudgetIdrKg}
                        value={formatMetricReadOnly(tcFreightBudgetIdrKg)}
                      />
                      <ReadOnlyInfoField
                        label={TC_VESSEL_PERF_LABELS.pumpRateMtH}
                        value={formatMetricReadOnly(pumpRate)}
                      />
                      <ReadOnlyInfoField label={TC_VESSEL_PERF_LABELS.sailingSpeed} value={formatMetricReadOnly(sailingSpeed)} />
                      <ReadOnlyInfoField
                        label={TC_VESSEL_PERF_LABELS.shortageMt}
                        value={formatMetricReadOnly(tcR4ShortageMt)}
                        helpText={TC_VESSEL_PERF_TOOLTIPS.shortageMt}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section 2: Shipment Detail */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={vesselModalSectionHeaderClass('blue')}>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100">
                  <FileText className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">2. Shipment Detail</h4>
                {step2Done && <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />}
              </div>
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <ReadOnlyInfoField
                    label="STO Number"
                    value={formatSapDisplayValue(stoNumber)}
                  />
                  <ReadOnlyInfoField
                    label="Operation ID"
                    value={formatSapDisplayValue(operationId)}
                  />
                  {readOnly && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        Shipment Status
                      </label>
                      <Badge className={shipmentStatusBadgeClass(shipmentStatus)}>
                        {formatShipmentStatusLabel(shipmentStatus)}
                      </Badge>
                    </div>
                  )}
                </div>

                {readOnly ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-gray-600" />
                      <h5 className="text-sm font-semibold text-gray-800">Uploaded Documents</h5>
                    </div>
                    {docsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading documents…
                      </div>
                    ) : shipmentDocuments.length === 0 ? (
                      <p className="text-sm text-gray-500">No documents uploaded for this shipment.</p>
                    ) : (
                      <ul className="space-y-2">
                        {shipmentDocuments.map((doc) => (
                          <li
                            key={doc.id}
                            className="flex flex-col gap-2 rounded-md border border-gray-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="text-[10px]">
                                  {doc.document_type || 'DOC'}
                                </Badge>
                                <span className="truncate text-sm font-medium text-gray-800">
                                  {doc.file_name}
                                </span>
                              </div>
                              {doc.created_at && (
                                <p className="mt-0.5 text-[11px] text-gray-500 tabular-nums">
                                  Uploaded {formatDateTimeDMY(doc.created_at)}
                                </p>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 shrink-0 text-xs"
                              onClick={() => void handleDownloadDocument(doc.id, doc.file_name)}
                            >
                              <Download className="mr-1 h-3.5 w-3.5" />
                              Download
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <p className="text-xs font-medium text-amber-900">Upload SLD</p>
                    <p className="mt-0.5 text-[11px] text-amber-800/80">Required to unlock Delivered / Received Qty (Klip).</p>
                    <input
                      id="edit-shipment-sld"
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => handleQtyDocUpload(SHIPMENT_SLD_DOC_TYPE, e)}
                      disabled={!canModifyCoreSections || sldDocUploading || hasUploadedSld}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-8 text-xs border-amber-300"
                      disabled={!canModifyCoreSections || sldDocUploading || hasUploadedSld}
                      onClick={() => document.getElementById('edit-shipment-sld')?.click()}
                    >
                      {sldDocUploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : hasUploadedSld ? (
                        <>
                          <Check className="h-3.5 w-3.5 mr-1 text-green-600" /> SLD uploaded
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5 mr-1" /> Upload SLD
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <p className="text-xs font-medium text-amber-900">Upload SDD</p>
                    <p className="mt-0.5 text-[11px] text-amber-800/80">Required to unlock Delivered / Received Qty (Klip).</p>
                    <input
                      id="edit-shipment-sdd"
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => handleQtyDocUpload(SHIPMENT_SDD_DOC_TYPE, e)}
                      disabled={!canModifyCoreSections || sddDocUploading || hasUploadedSdd}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-8 text-xs border-amber-300"
                      disabled={!canModifyCoreSections || sddDocUploading || hasUploadedSdd}
                      onClick={() => document.getElementById('edit-shipment-sdd')?.click()}
                    >
                      {sddDocUploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : hasUploadedSdd ? (
                        <>
                          <Check className="h-3.5 w-3.5 mr-1 text-green-600" /> SDD uploaded
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5 mr-1" /> Upload SDD
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                )}
                {!readOnly && !isQuantityUnlocked && (
                  <p className="text-[11px] text-amber-800/80">
                    Delivered Qty (Klip) / Received Qty (Klip) stay locked until at least one of SLD or SDD is uploaded.
                  </p>
                )}

                {editContext?.has_sap_sto && !readOnly && (
                  <p className="text-xs italic text-gray-500">
                    SAP STO shipment — Shipment Plan Qty saves to KLIP planning. PO can still be added when OS Qty (Actual) &gt; 0.
                  </p>
                )}

                {canAddPoOnEdit && shipmentId && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-gray-700">Add PO to shipment</label>
                      <span className="text-[10px] text-gray-500">OS Qty (Actual) &gt; 0</span>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1">
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          PO Number
                        </label>
                        <ShipmentPoSearchCombobox
                          shipmentId={shipmentId}
                          selected={selectedAddPoOption}
                          onSelect={setSelectedAddPoOption}
                          disabled={addingPo}
                          className="h-9 text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 shrink-0 bg-blue-600 px-4 text-white hover:bg-blue-700"
                        disabled={!selectedAddPoOption || addingPo}
                        onClick={() => void handleAddPo()}
                      >
                        {addingPo ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Add PO
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="text-xs italic text-gray-500">
                      Search by PO, contract, supplier, or product (min. 2 characters). Set Shipment Plan Qty in the table, then Save Changes.
                    </p>
                  </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className={VESSEL_MODAL_COMPACT_TH}>PO</TableHead>
                        <TableHead className={VESSEL_MODAL_COMPACT_TH}>Supplier</TableHead>
                        <TableHead className={VESSEL_MODAL_COMPACT_TH}>Product</TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="Metric tons (1 MT = 1,000 kg)">Contract Qty</span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="SAP STO-scoped delivered quantity">Delivered Qty (SAP)</span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="SAP STO-scoped receive quantity">Receive Qty (SAP)</span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="Contract qty minus STO-scoped SAP receive/delivery (incoterm-aware) — same as Shipping Performance">
                            OS Qty
                          </span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          <span title="KLIP plan on this STO — capped by OS Qty (Actual)">Shipment Plan Qty</span>
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          Delivered Qty (Klip)
                        </TableHead>
                        <TableHead className={`${VESSEL_MODAL_COMPACT_TH} text-right`}>
                          Received Qty (Klip)
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailRows.map((row) => {
                        const qtyRow = qtyTableRows.find((r) => r.rowKey === row.rowKey)!
                        const deliveredKlipKg = resolveRowQty(qtyRow, 'quantity_delivered')
                        const receiveKlipKg = resolveRowQty(qtyRow, 'quantity_receive')
                        const planKg = planQtyEdits[row.rowKey] ?? row.shipment_plan_qty ?? 0
                        return (
                          <TableRow key={row.rowKey}>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              {String(row.po_number || row.contract_number || '').trim() ? (
                                <button
                                  type="button"
                                  className="text-left font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                  title="View contract details"
                                  disabled={contractDetailLoading}
                                  onClick={() => void openContractDetailFromPoRow(row)}
                                >
                                  {formatSapDisplayValue(row.po_number || row.contract_number)}
                                </button>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <span className="line-clamp-2 text-gray-600">{row.supplier || '—'}</span>
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <span className="line-clamp-2 text-gray-600">{row.product || '—'}</span>
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <MtQtyReadOnly valueKg={row.contract_qty} />
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <MtQtyReadOnly valueKg={row.quantity_delivered_sap} />
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <MtQtyReadOnly valueKg={row.quantity_receive_sap} />
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              <MtQtyReadOnly valueKg={row.outstanding_qty_actual} />
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              {readOnly ? (
                                <MtQtyReadOnly valueKg={planKg} />
                              ) : (
                                <MtQtyInput
                                  valueKg={planKg}
                                  disabled={!canModifyCoreSections || planQtyReadOnly}
                                  onChange={(kg) =>
                                    setPlanQtyEdits((p) => ({ ...p, [row.rowKey]: kg ?? 0 }))
                                  }
                                />
                              )}
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              {readOnly ? (
                                <MtQtyReadOnly valueKg={deliveredKlipKg} />
                              ) : (
                                <MtQtyInput
                                  valueKg={deliveredKlipKg}
                                  disabled={!canModifyCoreSections || !isQuantityUnlocked}
                                  onChange={(kg) =>
                                    setQtyEdits((p) => ({
                                      ...p,
                                      [row.rowKey]: { ...p[row.rowKey], quantity_delivered: kg },
                                    }))
                                  }
                                />
                              )}
                            </TableCell>
                            <TableCell className={VESSEL_MODAL_COMPACT_TD}>
                              {readOnly ? (
                                <MtQtyReadOnly valueKg={receiveKlipKg} />
                              ) : (
                                <MtQtyInput
                                  valueKg={receiveKlipKg}
                                  disabled={!canModifyCoreSections || !isQuantityUnlocked}
                                  onChange={(kg) =>
                                    setQtyEdits((p) => ({
                                      ...p,
                                      [row.rowKey]: { ...p[row.rowKey], quantity_receive: kg },
                                    }))
                                  }
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow className={VESSEL_MODAL_TABLE_FOOTER_CLASS}>
                        <TableCell colSpan={3} className={VESSEL_MODAL_COMPACT_TD}>
                          Grand Total
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={poTableQtyTotals.contractQty} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={poTableQtyTotals.sapDelivered} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={poTableQtyTotals.sapReceive} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={poTableQtyTotals.osQty} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={totalShipmentPlanKg} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={qtyTotals.quantity_delivered} />
                        </TableCell>
                        <TableCell className={`${VESSEL_MODAL_COMPACT_TD} text-right`}>
                          <MtQtyReadOnly valueKg={qtyTotals.quantity_receive} />
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>

                {vesselCapacityMt != null && vesselCapacityMt > 0 && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="mb-1 flex justify-between text-xs text-gray-600">
                      <span>Total Shipment Plan Qty vs vessel capacity</span>
                      <span className="tabular-nums">
                        {formatNumber(totalShipmentPlanKg / 1000)} / {formatNumber(vesselCapacityMt)} MT
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{ width: `${Math.min(100, capacityPct)}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {canModifyCoreSections ? (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">SFAL Qty (MT)</label>
                        <MetricDecimalInput
                          value={sfalQty === null ? null : sfalQty / 1000}
                          onChange={(mt) => setSfalQty(mt === null ? null : mt * 1000)}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">SFBD Qty (MT)</label>
                        <MetricDecimalInput
                          value={sfbdQty === null ? null : sfbdQty / 1000}
                          onChange={(mt) => setSfbdQty(mt === null ? null : mt * 1000)}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <ReadOnlyInfoField
                        label="SFAL Qty (MT)"
                        value={formatMetricReadOnly(sfalQty === null ? null : sfalQty / 1000)}
                      />
                      <ReadOnlyInfoField
                        label="SFBD Qty (MT)"
                        value={formatMetricReadOnly(sfbdQty === null ? null : sfbdQty / 1000)}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Section 3: ETA + Loading Port */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={vesselModalSectionHeaderClass('violet', 'justify-between gap-2')}>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100">
                    <Clock className="h-3.5 w-3.5 text-violet-600" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-800">3. Estimation + Loading Port</h4>
                  {step3Done && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                </div>
                {canModifyCoreSections && (
                  <SectionActionGroup>
                    {!etaSectionIsEditing ? (
                      <>
                        <SectionEditButton
                          onClick={() => {
                            if (isMultiPortLoading) {
                              setEtaSectionEditing(true)
                              return
                            }
                            setEtaBlocks((prev) =>
                              prev.map((b) =>
                                b.status === 'active' ? { ...b, isEditing: true } : b,
                              ),
                            )
                          }}
                        />
                        {!isMultiPortLoading && !activeEtaBlock?.isDraft ? (
                          <SectionAddButton onClick={handleAddEta} />
                        ) : null}
                      </>
                    ) : (
                      <SectionCancelButton onClick={handleCancelEtaEdit} />
                    )}
                  </SectionActionGroup>
                )}
              </div>
              <div className="space-y-4 p-4">
                {isMultiPortLoading ? (
                  <>
                    {etaBlocks.map((block) => (
                      <div key={block.id} className="rounded-lg border border-blue-100 bg-white p-3">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Badge className="bg-blue-600 text-white text-[10px]">
                            Loading Port {block.portSequence}
                          </Badge>
                          <span className="text-xs text-gray-600">
                            {/* Multi-contract STO groups can have several ports sharing the same
                                port_sequence (each contract's shipment numbers its own ports from 1),
                                so match the exact row by portId — not by sequence, which would
                                collide and always resolve to the first port. */}
                            {resolveLoadingPortDisplayFromRow(
                              loadingPortRows.find((p) => p.id === block.portId) ??
                                loadingPortRows.find((p) => (p.port_sequence ?? 1) === block.portSequence),
                              shipmentInfo,
                              block.portSequence,
                            )}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                          {LOADING_ETA_FIELD_ROWS.map(({ key, label }) => (
                            <div key={`${block.id}-${key}`}>
                              <label className="mb-1 block text-[10px] font-medium text-gray-600">
                                {label}
                              </label>
                              {etaSectionEditing && canModifyCoreSections ? (
                                <DateInputDdMmYyyy
                                  valueIso={block.fields[key]}
                                  onChangeIso={(iso) => updateMultiPortEtaField(block.id, key, iso)}
                                  className="h-8 text-xs"
                                />
                              ) : (
                                <div className={`flex min-h-8 items-center ${ETA_INFO_VALUE_CLASS}`}>
                                  {formatDateDMY(block.fields[key]) || '—'}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                      <div className="mb-3 flex items-center gap-2">
                        <Badge variant="outline" className="border-indigo-300 text-[10px] text-indigo-700">
                          Shared discharge Estimation
                        </Badge>
                        <span className="text-xs text-gray-600">
                          One vessel timeline — unloading is the same for all loading ports
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {DISCHARGE_ETA_FIELD_ROWS.map(({ key, label }) => (
                          <div key={key}>
                            <label className="mb-1 block text-[10px] font-medium text-gray-600">
                              {label}
                            </label>
                            {etaSectionEditing && canModifyCoreSections ? (
                              <DateInputDdMmYyyy
                                valueIso={dischargeEtaFields[key]}
                                onChangeIso={(iso) => updateDischargeEtaField(key, iso)}
                                className="h-8 text-xs"
                              />
                            ) : (
                              <div className={`flex min-h-8 items-center ${ETA_INFO_VALUE_CLASS}`}>
                                {formatDateDMY(dischargeEtaFields[key]) || '—'}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                {activeEtaBlock && (
                  <div className="rounded-lg border border-blue-100 bg-white p-3">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge
                        className={
                          activeEtaBlock.isDraft
                            ? 'bg-amber-600 text-white text-[10px]'
                            : 'bg-blue-600 text-white text-[10px]'
                        }
                      >
                        {activeEtaBlock.isDraft ? 'New Estimation' : 'Active Estimation'}
                      </Badge>
                    </div>
                    <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Loading Port</label>
                        {activeEtaBlock.isEditing && canModifyCoreSections ? (
                          <Input
                            value={activeEtaBlock.loadingPort}
                            onChange={(e) =>
                              setEtaBlocks((prev) =>
                                prev.map((b) =>
                                  b.status === 'active' ? { ...b, loadingPort: e.target.value } : b,
                                ),
                              )
                            }
                            className="h-9 text-sm"
                          />
                        ) : (
                          <div className={`flex min-h-9 items-center ${ETA_INFO_VALUE_CLASS}`}>
                            {resolveLoadingPortDisplayFromRow(
                              loadingPortRows[0],
                              shipmentInfo,
                              loadingPortRows[0]?.port_sequence ?? 1,
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Apply to PO</label>
                        <div className={`flex min-h-9 items-center ${ETA_INFO_VALUE_CLASS}`}>
                          {formatInfoDisplayValue(activeEtaBlock.contractLabels.join(', '))}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {ETA_FIELD_ROWS.map(({ key, label }) => (
                        <div key={key}>
                          <label className="mb-1 block text-[10px] font-medium text-gray-600">{label}</label>
                          {activeEtaBlock.isEditing && canModifyCoreSections ? (
                            <DateInputDdMmYyyy
                              valueIso={activeEtaBlock.fields[key]}
                              onChangeIso={(iso) => updateActiveEtaField(key, iso)}
                              className="h-8 text-xs"
                            />
                          ) : (
                            <div className={`flex min-h-8 items-center ${ETA_INFO_VALUE_CLASS}`}>
                              {formatDateDMY(activeEtaBlock.fields[key]) || '—'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {historicalEtaBlocks.map((block) => (
                  <div key={block.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 opacity-80">
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        Previous Estimation (historical)
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {resolveLoadingPortDisplayFromRow(
                          loadingPortRows.find((p) => p.id === block.portId) ??
                            loadingPortRows.find((p) => (p.port_sequence ?? 1) === block.portSequence),
                          shipmentInfo,
                          block.portSequence,
                        )}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {ETA_FIELD_ROWS.map(({ key, label }) => (
                        <div key={key}>
                          <div className="text-[10px] text-gray-500">{label}</div>
                          <div className="text-xs font-medium">{formatDateDMY(block.fields[key]) || '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                  </>
                )}
              </div>
            </div>

            {/* Section 4: ATA */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={vesselModalSectionHeaderClass('emerald', 'justify-between gap-2')}>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-800">4. ATA Vessel Information</h4>
                  {step4Done && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                </div>
                {canEditAtaQuality && (
                  <SectionActionGroup>
                    <KlipSapCompareLegend />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowAtaDifferencesOnly((v) => !v)}
                    >
                      {showAtaDifferencesOnly ? 'Show all' : 'Diffs only'}
                    </Button>
                    {!ataIsEditing ? (
                      <SectionEditButton onClick={() => setAtaIsEditing(true)} />
                    ) : (
                      <SectionCancelButton onClick={() => void handleCancelAtaEdit()} />
                    )}
                  </SectionActionGroup>
                )}
                {!canEditAtaQuality ? <KlipSapCompareLegend className="ml-auto" /> : null}
              </div>
              <div className="space-y-4 p-4">
                {isMultiPortLoading ? (
                  <>
                    {loadingPortRows.map((portRow) => {
                      const ataKey = loadingPortAtaStateKey(portRow)
                      const portAta =
                        loadingPortAtaByKey[ataKey] ??
                        loadingAtaFromPortRow(
                          portRow,
                          portRow.shipment_id && String(portRow.shipment_id) === shipmentId
                            ? shipmentInfo
                            : {},
                        )
                      return (
                        <div
                          key={portRow.id || `ata-port-${portRow.port_sequence ?? 1}`}
                          className="rounded-lg border border-emerald-100 bg-white p-3"
                        >
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <Badge className="bg-emerald-600 text-white text-[10px]">
                              Loading Port {portRow.port_sequence ?? 1}
                            </Badge>
                            <span className="text-xs text-gray-600">
                              {resolveLoadingPortDisplayFromRow(
                                portRow,
                                shipmentInfo,
                                portRow.port_sequence ?? 1,
                              )}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                            {LOADING_ATA_FIELD_ROWS.map(({ key, label }) => {
                              const klipVal = portAta[key as keyof LoadingAtaFields]
                              const sapVal = resolveAtaSapReference(key, portRow)
                              return (
                                <KlipSapCompareField
                                  key={`${portRow.id ?? portRow.port_sequence}-${key}`}
                                  label={label}
                                  klipValue={klipVal}
                                  sapValue={sapVal}
                                  format="date"
                                  compact
                                  hidden={
                                    showAtaDifferencesOnly &&
                                    !hasKlipSapMismatch(klipVal, sapVal, 'date')
                                  }
                                  editing={ataIsEditing && canEditAtaQuality}
                                  editControl={
                                    <DateInputDdMmYyyy
                                      valueIso={klipVal}
                                      onChangeIso={(iso) =>
                                        setLoadingPortAtaByKey((prev) => ({
                                          ...prev,
                                          [ataKey]: {
                                            ...portAta,
                                            [key]: iso,
                                          },
                                        }))
                                      }
                                      className="h-8 text-xs"
                                    />
                                  }
                                />
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                    <div className="rounded-lg border border-emerald-100 bg-white p-3">
                      <p className="mb-3 text-[10px] font-medium text-gray-600">Discharge Port</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {DISCHARGE_ATA_FIELD_ROWS.map(({ key, label }) => {
                          const sapRef = resolveAtaSapReference(key, dischargePortRow)
                          const klipVal = ataFields[key]
                          const hasOverride = Boolean(klipVal && sapRef && klipVal !== sapRef)
                          return (
                            <KlipSapCompareField
                              key={key}
                              label={label}
                              klipValue={klipVal}
                              sapValue={sapRef}
                              format="date"
                              compact
                              showOverrideBadge={hasOverride}
                              hidden={
                                showAtaDifferencesOnly &&
                                !hasKlipSapMismatch(klipVal, sapRef, 'date')
                              }
                              editing={ataIsEditing && canEditAtaQuality}
                              editControl={
                                <DateInputDdMmYyyy
                                  valueIso={klipVal}
                                  onChangeIso={(iso) =>
                                    setAtaFields((prev) => ({ ...prev, [key]: iso }))
                                  }
                                  className="h-8 text-xs"
                                />
                              }
                            />
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {ATA_FIELD_ROWS.map(({ key, label }) => {
                      const loadingPortRow = loadingPortRows[0]
                      const sapRef = resolveAtaSapReference(key, loadingPortRow)
                      const klipVal = ataFields[key]
                      const hasOverride = Boolean(klipVal && sapRef && klipVal !== sapRef)
                      return (
                        <KlipSapCompareField
                          key={key}
                          label={label}
                          klipValue={klipVal}
                          sapValue={sapRef}
                          format="date"
                          compact
                          showOverrideBadge={hasOverride}
                          hidden={
                            showAtaDifferencesOnly &&
                            !hasKlipSapMismatch(klipVal, sapRef, 'date')
                          }
                          editing={ataIsEditing && canEditAtaQuality}
                          editControl={
                            <DateInputDdMmYyyy
                              valueIso={ataFields[key]}
                              onChangeIso={(iso) =>
                                setAtaFields((prev) => ({ ...prev, [key]: iso }))
                              }
                              className="h-8 text-xs"
                            />
                          }
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Section 5: Quality */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={vesselModalSectionHeaderClass('violet', 'justify-between gap-2')}>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100">
                    <FlaskConical className="h-3.5 w-3.5 text-violet-600" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-800">5. Quality Vessel Information</h4>
                  {step5Done && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                </div>
                {canEditAtaQuality && (
                  <SectionActionGroup>
                    <KlipSapCompareLegend />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowQualityDifferencesOnly((v) => !v)}
                    >
                      {showQualityDifferencesOnly ? 'Show all' : 'Diffs only'}
                    </Button>
                    {!qualityIsEditing ? (
                      <SectionEditButton onClick={() => setQualityIsEditing(true)} />
                    ) : (
                      <SectionCancelButton onClick={handleCancelQualityEdit} />
                    )}
                  </SectionActionGroup>
                )}
                {!canEditAtaQuality ? <KlipSapCompareLegend className="ml-auto" /> : null}
              </div>
              <div className="space-y-4 p-4">
                {loadingPortRows.map((portRow) => {
                  const qualityPortKey = loadingPortAtaStateKey(portRow)
                  const portQuality = qualityFieldsForPortKey(qualityPortKey)
                  const sapQuality = qualitySapReferenceFromPort(
                    portRow as Record<string, unknown>,
                  )
                  return (
                  <div
                    key={portRow.id || `quality-loading-${portRow.port_sequence ?? 1}`}
                    className="rounded-lg border border-violet-100 bg-white p-3"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {isMultiPortLoading ? (
                        <Badge className="bg-violet-600 text-white text-[10px]">
                          Loading Port {portRow.port_sequence ?? 1}
                        </Badge>
                      ) : null}
                      <span className="text-[10px] font-medium text-gray-600">Quality at Loading</span>
                      {isMultiPortLoading ? (
                        <span className="text-xs text-gray-600">
                          {resolveLoadingPortDisplayFromRow(
                            portRow,
                            shipmentInfo,
                            portRow.port_sequence ?? 1,
                          )}
                        </span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {QUALITY_METRICS.map(({ portKey, label }) => {
                        const fieldKey = portKey as keyof ShipmentQualityFields
                        const klipVal = portQuality[fieldKey]
                        const sapVal = sapQuality[fieldKey]
                        return (
                          <KlipSapCompareField
                            key={`${portRow.id ?? portRow.port_sequence}-${portKey}`}
                            label={label}
                            klipValue={klipVal}
                            sapValue={sapVal}
                            format="number"
                            compact
                            hidden={
                              showQualityDifferencesOnly &&
                              !hasKlipSapMismatch(klipVal, sapVal, 'number')
                            }
                            editing={qualityIsEditing && canEditAtaQuality}
                            editControl={
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={klipVal != null ? String(klipVal) : ''}
                                onChange={(e) =>
                                  updateQualityField(qualityPortKey, fieldKey, e.target.value)
                                }
                                className="h-8 text-xs"
                              />
                            }
                          />
                        )
                      })}
                    </div>
                  </div>
                )})}
                <div className="rounded-lg border border-violet-100 bg-white p-3">
                  <p className="mb-3 text-[10px] font-medium text-gray-600">Quality at Discharge</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {QUALITY_METRICS.map(({ portKey, label }) => {
                      const fieldKey = portKey as keyof ShipmentQualityFields
                      const dischargeQuality = qualityFieldsForPortKey(DISCHARGE_QUALITY_PORT_KEY)
                      const sapQuality = qualitySapReferenceFromPort(
                        dischargePortRow as Record<string, unknown> | undefined,
                      )
                      const klipVal = dischargeQuality[fieldKey]
                      const sapVal = sapQuality[fieldKey]
                      return (
                        <KlipSapCompareField
                          key={`discharge-${portKey}`}
                          label={label}
                          klipValue={klipVal}
                          sapValue={sapVal}
                          format="number"
                          compact
                          hidden={
                            showQualityDifferencesOnly &&
                            !hasKlipSapMismatch(klipVal, sapVal, 'number')
                          }
                          editing={qualityIsEditing && canEditAtaQuality}
                          editControl={
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={klipVal != null ? String(klipVal) : ''}
                              onChange={(e) =>
                                updateQualityField(
                                  DISCHARGE_QUALITY_PORT_KEY,
                                  fieldKey,
                                  e.target.value,
                                )
                              }
                              className="h-8 text-xs"
                            />
                          }
                        />
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 6: Remarks */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={vesselModalSectionHeaderClass('orange')}>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100">
                  <MessageSquare className="h-3.5 w-3.5 text-orange-700" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">6. Remarks</h4>
              </div>
              <div className="p-4">
                {shipmentRemarksLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading remarks…
                  </div>
                ) : shipmentRemarks.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {readOnly
                      ? 'No remarks recorded for this shipment yet.'
                      : 'No remarks yet. A remark is required when you change Estimation, quantities, ATA, or Quality.'}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {shipmentRemarks.map((remark) => (
                      <li
                        key={remark.id}
                        className="rounded-md border border-amber-100 bg-amber-50/40 px-3 py-2.5"
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">
                              {formatShipmentRemarkAuthor(remark)}
                            </span>
                            {formatShipmentRemarkCategory(remark.category) ? (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">
                                {formatShipmentRemarkCategory(remark.category)}
                              </span>
                            ) : null}
                          </div>
                          <span className="text-xs text-gray-500 tabular-nums">
                            {remark.created_at ? formatDateTimeDMY(remark.created_at) : '—'}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-800">
                          {remark.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Section 7: Activity History */}
            <div className={VESSEL_MODAL_SECTION_CLASS}>
              <div className={vesselModalSectionHeaderClass('slate')}>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100">
                  <History className="h-3.5 w-3.5 text-slate-600" />
                </div>
                <h4 className="text-sm font-semibold text-gray-800">7. Activity History</h4>
              </div>
              <div className="p-4">
                {activityLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading activity…
                  </div>
                ) : activityLog.length === 0 ? (
                  <p className="text-sm text-gray-500">No edit history recorded for this shipment yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {activityLog.map((log) => (
                      <li
                        key={log.id}
                        className="flex flex-col gap-0.5 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="font-medium text-gray-800">{formatActivityLabel(log)}</span>
                        <span className="text-xs text-gray-500 tabular-nums">
                          {formatDateTimeDMY(log.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={VESSEL_MODAL_FOOTER_BAR_CLASS}>
          {showRemarkField ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <label htmlFor="edit-shipment-remark" className="mb-1 block text-xs font-semibold text-amber-900">
                Remark <span className="text-red-600">*</span>
              </label>
              <textarea
                id="edit-shipment-remark"
                rows={2}
                value={editRemark}
                onChange={(e) => setEditRemark(e.target.value)}
                placeholder="Explain why Estimation, quantities, ATA, or Quality were changed…"
                className="w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-300"
              />
              <p className="mt-1 text-[11px] text-amber-800">
                Required when changing Estimation, Quantity Delivered (Klip), Received Qty (Klip), ATA, or Quality.
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {showSaveButton ? (
            <Button
              className="h-9 bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => void handleSave()}
              disabled={
                saving ||
                loading ||
                !shipmentId ||
                editRemarkMissing ||
                (readOnly && !hasLimitedEdits)
              }
              title={
                editRemarkMissing
                  ? 'Enter a remark before saving changes'
                  : undefined
              }
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          ) : null}
          </div>
        </div>
      </div>
    </div>

    <ContractDetailModal
      contract={contractDetailTarget}
      onClose={() => setContractDetailTarget(null)}
      stacked
    />
    </>
  )
}
