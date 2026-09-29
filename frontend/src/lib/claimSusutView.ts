import {
  buildPerformancePeriodOptions,
  resolvePerformancePeriodDateRange,
  type PerformancePeriodKey,
} from '@/lib/performancePeriodFilters'

// v2: the column set changed (empty columns dropped, Status Claim / CM Date added). A saved v1 list
// would hide Status Claim - saved choices replace the defaults - so everyone starts from the new ones.
export const CLAIM_SUSUT_VIEW_PREF_KEY = 'claim_susut.view.v2'
export const CLAIM_SUSUT_COLUMN_ORDER_KEY = 'claimSusut.columnOrder.v2'
export const CLAIM_SUSUT_BLANK = '(Blank)'

/** CR Date preset: All = entire import (Claim Susut register is multi-year). */
export type ClaimSusutPeriodKey = PerformancePeriodKey | 'ALL'

/**
 * The page opens on YTD by CR date. The outstanding register is multi-year, so YTD hides older open
 * claims (31 Aug 2026: 56 of 167 claims, Rp 6.36 B of 28.34 B); "All" shows the whole import.
 */
export const CLAIM_SUSUT_DEFAULT_PERIOD: ClaimSusutPeriodKey = 'YTD'

export function resolveClaimSusutPeriodRange(
  period: ClaimSusutPeriodKey,
  referenceDate = new Date(),
): { dateFrom: string; dateTo: string; label: string } {
  if (period === 'ALL') return { dateFrom: '', dateTo: '', label: 'All' }
  return resolvePerformancePeriodDateRange(period, referenceDate)
}

export function buildClaimSusutPeriodOptions(
  referenceDate = new Date(),
): Array<{ value: ClaimSusutPeriodKey; label: string }> {
  return [
    { value: 'ALL', label: 'All' },
    ...buildPerformancePeriodOptions(referenceDate),
  ]
}

export type ClaimSusutDrilldownLevel = 'product' | 'plant' | 'incoterm' | 'company'

export type ClaimSusutDrilldownFilters = {
  product: string | null
  plant: string | null
  incoterm: string | null
  company: string | null
}

export const EMPTY_CLAIM_SUSUT_DRILLDOWN: ClaimSusutDrilldownFilters = {
  product: null,
  plant: null,
  incoterm: null,
  company: null,
}

export const CLAIM_SUSUT_DRILLDOWN_CATEGORIES: ReadonlyArray<{
  level: ClaimSusutDrilldownLevel
  title: string
}> = [
  { level: 'product', title: 'Product' },
  { level: 'plant', title: 'Region/Plant' },
  { level: 'incoterm', title: 'Incoterm' },
  { level: 'company', title: 'Company' },
]

export const CLAIM_SUSUT_DRILLDOWN_LEVEL_STYLES: Record<
  ClaimSusutDrilldownLevel,
  { headerBg: string; border: string; bar: string; selectedBorder: string }
> = {
  product: {
    headerBg: 'bg-amber-50',
    border: 'border-amber-200',
    bar: 'bg-amber-400',
    selectedBorder: 'border-amber-400',
  },
  plant: {
    headerBg: 'bg-emerald-50',
    border: 'border-emerald-200',
    bar: 'bg-emerald-400',
    selectedBorder: 'border-emerald-400',
  },
  incoterm: {
    headerBg: 'bg-violet-50',
    border: 'border-violet-200',
    bar: 'bg-violet-400',
    selectedBorder: 'border-violet-400',
  },
  company: {
    headerBg: 'bg-rose-50',
    border: 'border-rose-200',
    bar: 'bg-rose-400',
    selectedBorder: 'border-rose-400',
  },
}

export type ClaimSusutColumnDef = {
  id: string
  label: string
  sortKey: string
  align?: 'left' | 'right'
}

/**
 * Only columns the OS_CLAIM sheet actually fills. Checked against the 31 Aug 2026 file (167 rows):
 * Payment Method, Source (vendor type) and Created By are not in the sheet at all, and its TAX
 * column is empty on every row (amount before tax = after tax), so all four were dropped. Incoterm (from
 * SAP contracts via the PO) and Region/Plant (derived from DEST, the same codes) are not in the file
 * either and are not offered. Labels follow the sheet's headers: Vendor Code (VENDOR CODE), Contract No
 * (NO KONTRAK), Remarks (KETERANGAN). The four
 * per-bucket amount columns (0-30 ... > 90 days) are one Aging column: the row's bucket and OS days.
 *
 * The table lists OS_CLAIM rows (Status Claim "Not Claimed") and REAL_CLAIM rows ("Claimed") together;
 * a claimed row has a CM Date and no aging.
 */
export const CLAIM_SUSUT_COLUMNS: ClaimSusutColumnDef[] = [
  { id: 'crno', label: 'CR NO', sortKey: 'crno' },
  { id: 'cr_date', label: 'CR Date', sortKey: 'cr_date' },
  { id: 'claim_status', label: 'Status Claim', sortKey: 'claim_status' },
  { id: 'group_of_transport', label: 'Group Of Transport', sortKey: 'group_of_transport' },
  { id: 'vendor_name', label: 'Vendor', sortKey: 'vendor_name' },
  { id: 'commodity', label: 'Product', sortKey: 'commodity' },
  { id: 'dest', label: 'Dest', sortKey: 'dest' },
  { id: 'po_number', label: 'PO Number', sortKey: 'po_number' },
  { id: 'qty_claim', label: 'Qty Claim (Kg)', sortKey: 'qty_claim', align: 'right' },
  { id: 'amount_after_tax_idr', label: 'Amount After Tax (IDR)', sortKey: 'amount_after_tax_idr', align: 'right' },
  { id: 'os_days', label: 'Aging (Days)', sortKey: 'os_days', align: 'right' },
  { id: 'vendor_code', label: 'Vendor Code', sortKey: 'vendor_code' },
  { id: 'sta', label: 'STA', sortKey: 'sta' },
  { id: 'contract_ext_no', label: 'Contract No', sortKey: 'contract_ext_no' },
  { id: 'comm', label: 'COMM', sortKey: 'comm' },
  { id: 'uom', label: 'UOM', sortKey: 'uom' },
  { id: 'currency', label: 'Currency', sortKey: 'currency' },
  { id: 'company_code', label: 'Company Code', sortKey: 'company_code' },
  { id: 'remarks', label: 'Remarks', sortKey: 'remarks' },
  { id: 'type', label: 'Type', sortKey: 'type' },
  { id: 'amount_before_tax_idr', label: 'Amount Before Tax (IDR)', sortKey: 'amount_before_tax_idr', align: 'right' },
  { id: 'cm_date', label: 'CM Date', sortKey: 'cm_date' },
]

export const CLAIM_SUSUT_DEFAULT_VISIBLE_IDS: readonly string[] = [
  'crno',
  'cr_date',
  'claim_status',
  'group_of_transport',
  'vendor_name',
  'commodity',
  'dest',
  'po_number',
  'qty_claim',
  'amount_after_tax_idr',
  'os_days',
]

export const CLAIM_SUSUT_NUMERIC_SORT_KEYS = new Set(['os_days', 'qty_claim', 'amount_before_tax_idr', 'amount_after_tax_idr'])

/** The aging bucket of a claim, on the same thresholds as the Aging tab and the PIVOT sheet. */
export function claimSusutAgingBucket(osDays: number | null | undefined): string | null {
  if (osDays == null || !Number.isFinite(Number(osDays)) || Number(osDays) < 0) return null
  const d = Number(osDays)
  if (d <= 30) return '0-30'
  if (d <= 60) return '31-60'
  if (d <= 90) return '61-90'
  return '> 90'
}

export function isClaimSusutDrilldownValueSet(value: string | null | undefined): value is string {
  return value != null && value !== ''
}

export function hasClaimSusutDrilldownSelection(filters: ClaimSusutDrilldownFilters): boolean {
  return (
    isClaimSusutDrilldownValueSet(filters.product) ||
    isClaimSusutDrilldownValueSet(filters.plant) ||
    isClaimSusutDrilldownValueSet(filters.incoterm) ||
    isClaimSusutDrilldownValueSet(filters.company)
  )
}

export function buildNextClaimSusutDrilldownSelection(
  prev: ClaimSusutDrilldownFilters,
  level: ClaimSusutDrilldownLevel,
  label: string,
): ClaimSusutDrilldownFilters {
  if (level === 'product') {
    return { product: label, plant: null, incoterm: null, company: null }
  }
  if (level === 'plant') {
    return { ...prev, plant: label, incoterm: null, company: null }
  }
  if (level === 'incoterm') {
    return { ...prev, incoterm: label, company: null }
  }
  return { ...prev, company: label }
}

export function claimSusutDrilldownColumnSubtitle(
  level: ClaimSusutDrilldownLevel,
  filters: ClaimSusutDrilldownFilters,
): string {
  switch (level) {
    case 'product':
      return isClaimSusutDrilldownValueSet(filters.product) ? `Selected: ${filters.product}` : 'Pick one'
    case 'plant':
      if (!isClaimSusutDrilldownValueSet(filters.product)) return 'Pick product first'
      return isClaimSusutDrilldownValueSet(filters.plant)
        ? `${filters.product} › ${filters.plant}`
        : `Under ${filters.product}`
    case 'incoterm':
      if (!isClaimSusutDrilldownValueSet(filters.product) || !isClaimSusutDrilldownValueSet(filters.plant)) {
        return 'Pick region/plant first'
      }
      return isClaimSusutDrilldownValueSet(filters.incoterm)
        ? `${filters.plant} › ${filters.incoterm}`
        : `Under ${filters.plant}`
    case 'company':
      if (!isClaimSusutDrilldownValueSet(filters.incoterm)) return 'Pick incoterm first'
      return isClaimSusutDrilldownValueSet(filters.company)
        ? `${filters.incoterm} › ${filters.company}`
        : `Under ${filters.incoterm}`
    default:
      return ''
  }
}

export type ClaimSusutApiFilters = {
  importId?: string
  dateFrom?: string
  dateTo?: string
  plants?: string[]
  sources?: string[]
  incoterms?: string[]
  products?: string[]
  vendors?: string[]
  /** View table only: Claimed (REAL_CLAIM) / Not Claimed (OS_CLAIM). */
  claimStatuses?: string[]
  groupsOfTransport?: string[]
  drilldown?: ClaimSusutDrilldownFilters
}

export function appendClaimSusutFilterParams(
  params: URLSearchParams,
  filters: ClaimSusutApiFilters,
  opts?: { includeDrilldown?: boolean; includeGroup?: boolean },
): URLSearchParams {
  const includeDrilldown = opts?.includeDrilldown !== false
  const includeGroup = opts?.includeGroup !== false
  if (filters.importId) params.set('importId', filters.importId)
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  for (const v of filters.plants ?? []) params.append('plant', v)
  for (const v of filters.sources ?? []) params.append('source', v)
  for (const v of filters.incoterms ?? []) params.append('incoterm', v)
  for (const v of filters.products ?? []) params.append('product', v)
  for (const v of filters.vendors ?? []) params.append('vendor', v)
  for (const v of filters.claimStatuses ?? []) params.append('claimStatus', v)
  if (includeGroup) {
    for (const v of filters.groupsOfTransport ?? []) params.append('groupOfTransport', v)
  }
  if (includeDrilldown && filters.drilldown) {
    if (filters.drilldown.product) params.set('ddProduct', filters.drilldown.product)
    if (filters.drilldown.plant) params.set('ddPlant', filters.drilldown.plant)
    if (filters.drilldown.incoterm) params.set('ddIncoterm', filters.drilldown.incoterm)
    if (filters.drilldown.company) params.set('ddCompany', filters.drilldown.company)
  }
  return params
}

export function formatClaimSusutIdr(n: number | undefined | null): string {
  const v = Number(n || 0)
  return v.toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

export type ClaimSusutTreeNode = {
  key: string
  label: string
  qtyClaim: number
  amountAfterTax: number
  children: ClaimSusutTreeNode[]
}

export function claimSusutTreeNodesForLevel(
  tree: ClaimSusutTreeNode[],
  filters: ClaimSusutDrilldownFilters,
  level: ClaimSusutDrilldownLevel,
): ClaimSusutTreeNode[] {
  const productNode = tree.find((n) => n.key === filters.product)
  const plantNode = productNode?.children.find((n) => n.key === filters.plant)
  const incotermNode = plantNode?.children.find((n) => n.key === filters.incoterm)
  if (level === 'product') return tree
  if (level === 'plant') return productNode?.children ?? []
  if (level === 'incoterm') return plantNode?.children ?? []
  return incotermNode?.children ?? []
}

export function looksLikeLegacyAllVisibleClaimSusutColumns(savedIds: string[]): boolean {
  const allIds = CLAIM_SUSUT_COLUMNS.map((c) => c.id)
  if (savedIds.length === 0) return true
  const saved = new Set(savedIds)
  return allIds.filter((id) => id !== 'incoterm' && id !== 'region_plant').every((id) => saved.has(id))
}

export interface ClaimSusutImportError {
  rowIndex: number
  message: string
}

export function parseClaimSusutImportErrors(errors: unknown): ClaimSusutImportError[] {
  if (!Array.isArray(errors)) return []
  return errors.map((entry) => {
    if (entry && typeof entry === 'object') {
      const o = entry as { rowIndex?: unknown; message?: unknown }
      return {
        rowIndex: Number(o.rowIndex) || 0,
        message: String(o.message ?? '').trim() || 'Unknown error',
      }
    }
    return { rowIndex: 0, message: String(entry ?? '').trim() || 'Unknown error' }
  })
}

export function claimSusutImportFailedCount(
  errors: unknown,
  totalRows?: number,
  insertedRows?: number,
): number {
  const parsed = parseClaimSusutImportErrors(errors)
  if (parsed.length > 0) return parsed.length
  return Math.max(0, (Number(totalRows) || 0) - (Number(insertedRows) || 0))
}

export function claimSusutImportSuccessRate(totalRows: number, insertedRows: number): number {
  if (totalRows > 0) return Number(((insertedRows / totalRows) * 100).toFixed(1))
  return insertedRows > 0 ? 100 : 0
}

export type ClaimSusutImportStatus = 'completed' | 'partial' | 'failed'

export function claimSusutImportStatus(
  insertedRows: number,
  failedRows: number,
): ClaimSusutImportStatus {
  if (failedRows <= 0 && insertedRows > 0) return 'completed'
  if (insertedRows <= 0) return 'failed'
  return 'partial'
}
