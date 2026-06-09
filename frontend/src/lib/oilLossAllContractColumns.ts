/**
 * Oil Loss — Section 3 "All Contract" compact table column order, visibility, and aggregation.
 * Scoped to `/oil-loss` when viewMode === 'all_contract' only.
 */

export const OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION = 'oil-loss-all-contract-v1'
export const OIL_LOSS_ALL_CONTRACT_COLUMN_LAYOUT_VERSION_KEY =
  'oil-loss.all-contract.compact.columnLayoutVersion'

/** Default visible columns in left-to-right table order. */
export const OIL_LOSS_ALL_CONTRACT_DEFAULT_VISIBLE_COLUMN_IDS: readonly string[] = [
  'contract_date',
  'contract_ext_no',
  'po_number',
  'sto_number',
  'product',
  'incoterm',
  'quantity_contract',
  'quantity_delivery',
  'quantity_received',
  'gain_loss_amount',
  'gain_loss_percentage',
  'status',
] as const

export const OIL_LOSS_ALL_CONTRACT_COLUMN_WIDTH_PX: Readonly<Record<string, number>> = {
  contract_date: 100,
  contract_ext_no: 120,
  po_number: 110,
  sto_number: 110,
  product: 120,
  incoterm: 72,
  quantity_contract: 96,
  quantity_delivery: 96,
  quantity_received: 96,
  gain_loss_amount: 96,
  gain_loss_percentage: 88,
  status: 80,
  transport_mode: 72,
  group_name: 88,
  supplier: 120,
  buyer: 88,
  plant_site: 100,
  operation_id: 120,
  contract_number: 110,
  quantity_sfal: 96,
  quantity_sfbd: 96,
}

export type OilLossSourceRow = {
  id: string
  transport_mode?: 'LAND' | 'SEA' | string | null
  operation_id?: string | null
  contract_number?: string | null
  contract_ext_no?: string | null
  contract_date?: string | null
  operation_date?: string | null
  sto_number?: string | null
  po_number?: string | null
  supplier?: string | null
  buyer?: string | null
  product?: string | null
  group_name?: string | null
  plant_site?: string | null
  incoterm?: string | null
  group_plant?: string | null
  quantity_contract?: number | null
  /** Qty Delivery from SAP Data (Kg). */
  quantity_delivery?: number | null
  /** Alias of quantity_delivery for legacy consumers. */
  quantity_sent?: number | null
  /** Qty Receive from SAP Data (Kg). */
  quantity_received?: number | null
  quantity_sfal?: number | null
  quantity_sfbd?: number | null
  gain_loss_amount?: number | null
  gain_loss_percentage?: number | null
  status?: string | null
  transporter?: string | null
  loading_location?: string | null
  unloading_location?: string | null
}

export type OilLossAllContractRow = {
  id: string
  contract_date: string | null
  contract_ext_no: string | null
  po_number: string | null
  sto_number: string | null
  product: string | null
  incoterm: string | null
  quantity_contract: number | null
  quantity_delivery: number | null
  quantity_received: number | null
  gain_loss_amount: number | null
  gain_loss_percentage: number | null
  status: string | null
  transport_mode: string | null
  group_name: string | null
  supplier: string | null
  buyer: string | null
  plant_site: string | null
  operation_id: string | null
  contract_number: string | null
  quantity_sfal: number | null
  quantity_sfbd: number | null
  row_count: number
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function mergeDistinctTokens(existing: string | null | undefined, incoming: string | null | undefined): string {
  const parts = new Set<string>()
  for (const raw of [existing, incoming]) {
    const s = String(raw ?? '').trim()
    if (!s) continue
    for (const piece of s.split(',')) {
      const t = piece.trim()
      if (t) parts.add(t)
    }
  }
  return [...parts].join(', ')
}

function pickLaterDate(a: string | null, b: string | null): string | null {
  const sa = String(a ?? '').slice(0, 10)
  const sb = String(b ?? '').slice(0, 10)
  if (!sa) return sb || null
  if (!sb) return sa || null
  return sa >= sb ? sa : sb
}

function contractGroupKey(row: OilLossSourceRow): string {
  const cn = String(row.contract_number ?? '').trim()
  if (cn) return `cn:${cn}`
  const ext = String(row.contract_ext_no ?? '').trim()
  if (ext) return `ext:${ext}`
  return `row:${row.id}`
}

function resolveContractDate(row: OilLossSourceRow): string | null {
  const d = String(row.contract_date ?? row.operation_date ?? '').slice(0, 10)
  return d || null
}

export function aggregateOilLossByContract(rows: OilLossSourceRow[]): OilLossAllContractRow[] {
  const map = new Map<string, OilLossAllContractRow>()

  for (const row of rows) {
    const key = contractGroupKey(row)
    const delivery = parseNum(row.quantity_sent) ?? 0
    const received = parseNum(row.quantity_received) ?? 0
    const contractDate = resolveContractDate(row)

    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        id: key,
        contract_date: contractDate,
        contract_ext_no: String(row.contract_ext_no ?? '').trim() || null,
        po_number: String(row.po_number ?? '').trim() || null,
        sto_number: String(row.sto_number ?? '').trim() || null,
        product: String(row.product ?? '').trim() || null,
        incoterm: String(row.incoterm ?? '').trim() || null,
        quantity_contract: parseNum(row.quantity_contract),
        quantity_delivery: delivery,
        quantity_received: received,
        gain_loss_amount: received - delivery,
        gain_loss_percentage:
          delivery > 0 ? Number((((received - delivery) / delivery) * 100).toFixed(4)) : 0,
        status: String(row.status ?? '').trim() || null,
        transport_mode: String(row.transport_mode ?? '').trim() || null,
        group_name: String(row.group_name ?? '').trim() || null,
        supplier: String(row.supplier ?? '').trim() || null,
        buyer: String(row.buyer ?? '').trim() || null,
        plant_site: String(row.plant_site ?? '').trim() || null,
        operation_id: String(row.operation_id ?? '').trim() || null,
        contract_number: String(row.contract_number ?? '').trim() || null,
        quantity_sfal: parseNum(row.quantity_sfal),
        quantity_sfbd: parseNum(row.quantity_sfbd),
        row_count: 1,
      })
      continue
    }

    existing.contract_date = pickLaterDate(existing.contract_date, contractDate)
    existing.contract_ext_no = mergeDistinctTokens(existing.contract_ext_no, row.contract_ext_no) || null
    existing.po_number = mergeDistinctTokens(existing.po_number, row.po_number) || null
    existing.sto_number = mergeDistinctTokens(existing.sto_number, row.sto_number) || null
    if (!existing.product) existing.product = String(row.product ?? '').trim() || null
    if (!existing.incoterm) existing.incoterm = String(row.incoterm ?? '').trim() || null
    if (!existing.status) existing.status = String(row.status ?? '').trim() || null
    if (!existing.supplier) existing.supplier = String(row.supplier ?? '').trim() || null
    if (!existing.product && row.product) existing.product = String(row.product).trim()
    const contractQty = parseNum(row.quantity_contract)
    if (contractQty != null) {
      existing.quantity_contract =
        existing.quantity_contract == null
          ? contractQty
          : Math.max(existing.quantity_contract, contractQty)
    }
    existing.quantity_delivery = (existing.quantity_delivery ?? 0) + delivery
    existing.quantity_received = (existing.quantity_received ?? 0) + received
    existing.gain_loss_amount = (existing.quantity_received ?? 0) - (existing.quantity_delivery ?? 0)
    const totalDelivery = existing.quantity_delivery ?? 0
    existing.gain_loss_percentage =
      totalDelivery > 0
        ? Number((((existing.gain_loss_amount ?? 0) / totalDelivery) * 100).toFixed(4))
        : 0
    existing.quantity_sfal = (existing.quantity_sfal ?? 0) + (parseNum(row.quantity_sfal) ?? 0)
    existing.quantity_sfbd = (existing.quantity_sfbd ?? 0) + (parseNum(row.quantity_sfbd) ?? 0)
    existing.row_count += 1
  }

  return [...map.values()]
}

export function oilLossAllContractDefaultVisibleColumnIds(allIds: string[]): string[] {
  return OIL_LOSS_ALL_CONTRACT_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
}

export function oilLossAllContractCompactColumnFallbackOrder(allIds: string[]): string[] {
  const primary = [...OIL_LOSS_ALL_CONTRACT_DEFAULT_VISIBLE_COLUMN_IDS]
  const hiddenOrder = [
    'transport_mode',
    'group_name',
    'supplier',
    'buyer',
    'plant_site',
    'operation_id',
    'contract_number',
    'quantity_sfal',
    'quantity_sfbd',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...primary, ...hiddenOrder]) {
    if (allIds.includes(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of allIds) {
    if (!seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  return out
}

export function mergeOilLossAllContractColumnOrder(saved: string[], allIds: string[]): string[] {
  const canonical = oilLossAllContractCompactColumnFallbackOrder(allIds)
  if (saved.length === 0) return canonical

  const primary = OIL_LOSS_ALL_CONTRACT_DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => allIds.includes(id))
  const primarySet = new Set(primary)
  const extras: string[] = []
  const seen = new Set<string>()

  for (const id of saved) {
    if (allIds.includes(id) && !primarySet.has(id) && !seen.has(id)) {
      extras.push(id)
      seen.add(id)
    }
  }
  for (const id of canonical) {
    if (!primarySet.has(id) && !seen.has(id)) {
      extras.push(id)
      seen.add(id)
    }
  }
  return [...primary, ...extras]
}

export function buildOilLossAllContractVisibleColumns<T extends { id: string }>(
  columns: T[],
  visibleIds: ReadonlySet<string>,
  orderIds: readonly string[],
): T[] {
  const byId = new Map(columns.map((c) => [c.id, c]))
  const order =
    orderIds.length > 0 ? orderIds : oilLossAllContractCompactColumnFallbackOrder(columns.map((c) => c.id))
  const out: T[] = []
  for (const id of order) {
    if (!visibleIds.has(id)) continue
    const col = byId.get(id)
    if (col) out.push(col)
  }
  return out
}
