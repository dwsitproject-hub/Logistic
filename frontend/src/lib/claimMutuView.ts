/**
 * Claim Mutu page: columns, filters and the orderings the claim team's workbook uses.
 *
 * Every summary is recomputed by the backend from the imported OS_Claim / Real_Claim rows
 * (backend/src/controllers/claimMutu.controller.ts); this file only shapes them for display.
 */

export const CLAIM_MUTU_VIEW_PREF_KEY = 'claim_mutu.view.v2'
export const CLAIM_MUTU_COLUMN_ORDER_KEY = 'claimMutu.columnOrder.v2'
export const CLAIM_MUTU_BLANK = '(Blank)'

/**
 * Exclude is the scope of the Pivot, Summary Per Komoditi and Rekap Klaim Per Lokasi sheets, and
 * what the page opens with. Include is the scope of the Summary Per Unit sheet.
 */
export type ClaimMutuB2bScope = 'exclude' | 'include'
export const CLAIM_MUTU_DEFAULT_B2B: ClaimMutuB2bScope = 'exclude'

export type ClaimMutuApiFilters = {
  importId?: string
  b2b: ClaimMutuB2bScope
  dateFrom?: string
  dateTo?: string
  commodities?: string[]
  units?: string[]
  vendorTypes?: string[]
  claimGroups?: string[]
  metodePayments?: string[]
}

export function appendClaimMutuFilterParams(
  params: URLSearchParams,
  f: ClaimMutuApiFilters,
  opts?: { omitImport?: boolean },
): URLSearchParams {
  if (f.importId && !opts?.omitImport) params.set('importId', f.importId)
  params.set('b2b', f.b2b)
  if (f.dateFrom) params.set('dateFrom', f.dateFrom)
  if (f.dateTo) params.set('dateTo', f.dateTo)
  const list = (key: string, values?: string[]) => {
    for (const v of values ?? []) params.append(key, v)
  }
  list('commodities', f.commodities)
  list('units', f.units)
  list('vendorTypes', f.vendorTypes)
  list('claimGroups', f.claimGroups)
  list('metodePayments', f.metodePayments)
  return params
}

/** Commodity order of the Summary Per Komoditi sheet; anything new follows alphabetically. */
export const CLAIM_MUTU_COMMODITY_ORDER: readonly string[] = [
  'CPO',
  'CPKO',
  'PK',
  'RBDPS',
  'RPO',
  'SHELL PALM',
  'WASTE OIL (POME)',
]

/** Unit (discharge) order of the Summary Per Unit sheet; anything new follows alphabetically. */
export const CLAIM_MUTU_UNIT_ORDER: readonly string[] = [
  'BAGENDANG',
  'BONTANG',
  'TANJUNG PURA',
  'LUBUK GAUNG',
  'TANJUNG MORAWA',
  'SALO PALAI',
  'KARAWANG',
  'JAKARTA (TRADING PLANT)',
  'TANJUNG BUTON',
  'BEKASI',
  'TANGERANG',
  'MERAUKE',
  'RIAU',
  'SUNGAI GUNTUNG',
  'KUMAI',
  'BATAM',
  'PALEMBANG',
  'JAMBI',
]

/** Sorts by a reference order, then alphabetically, with (Blank) last. */
export function orderBy(reference: readonly string[]) {
  const rank = new Map(reference.map((v, i) => [v, i]))
  return (a: string, b: string): number => {
    if (a === b) return 0
    if (a === CLAIM_MUTU_BLANK) return 1
    if (b === CLAIM_MUTU_BLANK) return -1
    const ra = rank.get(a.trim().toUpperCase())
    const rb = rank.get(b.trim().toUpperCase())
    if (ra != null && rb != null) return ra - rb
    if (ra != null) return -1
    if (rb != null) return 1
    return a.localeCompare(b)
  }
}

export const compareCommodity = orderBy(CLAIM_MUTU_COMMODITY_ORDER)
export const compareUnit = orderBy(CLAIM_MUTU_UNIT_ORDER)

export type ClaimMutuSidePair = { os_qty: number; os_amount: number; real_qty: number; real_amount: number }

export const addPair = (a: ClaimMutuSidePair, b: ClaimMutuSidePair): ClaimMutuSidePair => ({
  os_qty: a.os_qty + (Number(b.os_qty) || 0),
  os_amount: a.os_amount + (Number(b.os_amount) || 0),
  real_qty: a.real_qty + (Number(b.real_qty) || 0),
  real_amount: a.real_amount + (Number(b.real_amount) || 0),
})

export const ZERO_PAIR: ClaimMutuSidePair = { os_qty: 0, os_amount: 0, real_qty: 0, real_amount: 0 }

export type ClaimMutuCommodityUnitRow = ClaimMutuSidePair & { commodity: string; unit: string }

export type ClaimMutuCommodityGroup = {
  commodity: string
  units: ClaimMutuCommodityUnitRow[]
  subtotal: ClaimMutuSidePair
}

/**
 * Summary Per Komoditi: commodities in the sheet's order, units within each in the unit order,
 * with a sub total per commodity. Cells that are zero on both sides are dropped, as the sheet does.
 */
export function groupByCommodity(rows: ClaimMutuCommodityUnitRow[]): {
  groups: ClaimMutuCommodityGroup[]
  total: ClaimMutuSidePair
} {
  const byCommodity = new Map<string, ClaimMutuCommodityUnitRow[]>()
  for (const r of rows) {
    if (!r.os_qty && !r.os_amount && !r.real_qty && !r.real_amount) continue
    byCommodity.set(r.commodity, [...(byCommodity.get(r.commodity) ?? []), r])
  }
  const groups = [...byCommodity.entries()]
    .sort(([a], [b]) => compareCommodity(a, b))
    .map(([commodity, units]) => ({
      commodity,
      units: [...units].sort((a, b) => compareUnit(a.unit, b.unit)),
      subtotal: units.reduce(addPair, ZERO_PAIR),
    }))
  return { groups, total: groups.reduce((s, g) => addPair(s, g.subtotal), ZERO_PAIR) }
}

export type ClaimMutuTrendRow = ClaimMutuSidePair & { month: string; unit: string }

/** Summary Per Unit: units (columns) that have any value in any month, in the sheet's order. */
export function trendUnits(rows: ClaimMutuTrendRow[]): string[] {
  const units = new Set<string>()
  for (const r of rows) if (r.os_qty || r.os_amount || r.real_qty || r.real_amount) units.add(r.unit)
  return [...units].sort(compareUnit)
}

const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

/** "2026-08-01" -> "Agustus 2026". */
export function formatClaimMutuMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso || '')
  if (!m) return iso || '-'
  return `${MONTHS_ID[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

export function formatClaimMutuIdr(n: number | undefined | null): string {
  const v = Number(n || 0)
  return v.toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

/** Kilograms, as every Claim Mutu sheet reports quantity. */
export function formatClaimMutuKg(n: number | undefined | null): string {
  const v = Number(n || 0)
  return v.toLocaleString('id-ID', { maximumFractionDigits: 2 })
}

/** A value's share of a total, "56.2%"; a dash when either is zero, as the workbook shows it. */
export function formatShare(part: number, total: number): string {
  if (!total || !part) return '-'
  return `${((part / total) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
}

export type ClaimMutuColumnDef = {
  id: string
  label: string
  sortKey: string
  align?: 'left' | 'right'
  kind?: 'date' | 'idr' | 'kg' | 'number' | 'b2b'
}

export const CLAIM_MUTU_COLUMNS: ClaimMutuColumnDef[] = [
  { id: 'crno', label: 'CR No', sortKey: 'crno' },
  { id: 'cr_date', label: 'CR Date', sortKey: 'cr_date', kind: 'date' },
  { id: 'claim_group', label: 'Group', sortKey: 'claim_group' },
  { id: 'vendor_name', label: 'Vendor Name', sortKey: 'vendor_name' },
  { id: 'commodity', label: 'Commodity', sortKey: 'commodity' },
  { id: 'unit', label: 'Unit', sortKey: 'unit' },
  { id: 'dest', label: 'Dest', sortKey: 'dest' },
  { id: 'po_number', label: 'PO Number', sortKey: 'po_number' },
  { id: 'qty_claim_kg', label: 'Qty Claim (Kg)', sortKey: 'qty_claim_kg', align: 'right', kind: 'kg' },
  { id: 'amount_after_tax_idr', label: 'Amount After Tax (IDR)', sortKey: 'amount_after_tax_idr', align: 'right', kind: 'idr' },
  { id: 'os_days', label: 'OS Days', sortKey: 'os_days', align: 'right', kind: 'number' },
  { id: 'aging', label: 'Aging', sortKey: 'os_days' },
  { id: 'metode_payment', label: 'Metode Payment', sortKey: 'metode_payment' },
  { id: 'is_b2b', label: 'B2B', sortKey: 'is_b2b', kind: 'b2b' },
  { id: 'vendor_code', label: 'Vendor Code', sortKey: 'vendor_code' },
  { id: 'vendor_type', label: 'Vendor Type', sortKey: 'vendor_type' },
  { id: 'group_of_vendor', label: 'Group of Vendor', sortKey: 'group_of_vendor' },
  { id: 'cargo_source', label: 'Cargo Source', sortKey: 'cargo_source' },
  { id: 'keterangan', label: 'Keterangan', sortKey: 'keterangan' },
  { id: 'type_of_comp', label: 'Type of Comp', sortKey: 'type_of_comp' },
  { id: 'traders', label: 'Traders', sortKey: 'traders' },
  { id: 'created_by', label: 'Created By', sortKey: 'created_by' },
  { id: 'sta', label: 'STA', sortKey: 'sta' },
  { id: 'contract_ext_no', label: 'Contract Ext No', sortKey: 'contract_ext_no' },
  { id: 'comm', label: 'COMM', sortKey: 'comm' },
  { id: 'material_description', label: 'Material Description', sortKey: 'material_description' },
  { id: 'company_code', label: 'Company Code', sortKey: 'company_code' },
  { id: 'claim_type', label: 'Claim Type', sortKey: 'claim_type' },
  { id: 'mutu_kontrak_ffa', label: 'Kontrak FFA', sortKey: 'mutu_kontrak_ffa', align: 'right', kind: 'number' },
  { id: 'mutu_kontrak_mi', label: 'Kontrak M&I', sortKey: 'mutu_kontrak_mi', align: 'right', kind: 'number' },
  { id: 'mutu_kontrak_dns', label: 'Kontrak DNS', sortKey: 'mutu_kontrak_dns', align: 'right', kind: 'number' },
  { id: 'mutu_kontrak_dobi', label: 'Kontrak DOBI', sortKey: 'mutu_kontrak_dobi', align: 'right', kind: 'number' },
  { id: 'mutu_klaim_ffa', label: 'Klaim FFA', sortKey: 'mutu_klaim_ffa', align: 'right', kind: 'number' },
  { id: 'mutu_klaim_mi', label: 'Klaim M&I', sortKey: 'mutu_klaim_mi', align: 'right', kind: 'number' },
  { id: 'mutu_klaim_dns', label: 'Klaim DNS', sortKey: 'mutu_klaim_dns', align: 'right', kind: 'number' },
  { id: 'mutu_klaim_dobi', label: 'Klaim DOBI', sortKey: 'mutu_klaim_dobi', align: 'right', kind: 'number' },
  { id: 'uom', label: 'UOM', sortKey: 'uom' },
  { id: 'amount_before_tax_idr', label: 'Amount Before Tax (IDR)', sortKey: 'amount_before_tax_idr', align: 'right', kind: 'idr' },
  { id: 'tax', label: 'Tax', sortKey: 'tax', align: 'right', kind: 'idr' },
]

export const CLAIM_MUTU_DEFAULT_VISIBLE_IDS: readonly string[] = [
  'crno',
  'cr_date',
  'claim_group',
  'vendor_name',
  'commodity',
  'unit',
  'po_number',
  'qty_claim_kg',
  'amount_after_tax_idr',
  'os_days',
  'aging',
  'metode_payment',
]

export const CLAIM_MUTU_NUMERIC_SORT_KEYS = new Set(
  CLAIM_MUTU_COLUMNS.filter((c) => c.align === 'right').map((c) => c.sortKey),
)
