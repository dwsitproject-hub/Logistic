/**
 * Oil Loss — shared mode-aware grouping key + two-level ("contract-then-voyage") aggregation.
 *
 * Cardinality (see plan): SEA (FOB/CIF/CFR) — one STO/voyage Operation ID can span multiple
 * POs/contracts, which must merge into one row/total (summed). LAND (FRC/LCO) — an Operation ID
 * is already 1:1 with its PO, so grouping by Operation ID is a no-op vs. grouping by contract.
 *
 * Level 1 (existing behavior, unchanged): dedupe multiple SAP rows of the SAME contract —
 * take delivery/receive once, sum SFAL/SFBD across duplicate rows.
 * Level 2 (new): merge distinct contracts sharing one SEA voyage Operation ID — sum their
 * level-1 subtotals. For LAND this is a no-op because the outer key already equals the
 * contract key.
 */

import type { OilLossSourceRow } from '@/lib/oilLossAllContractColumns'

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Sum SFAL/SFBD without coercing missing values to 0. All-null stays null; genuine 0 is kept. */
export function sumNullableOilLossQtyKg(
  existing: number | null | undefined,
  incoming: number | null | undefined,
): number | null {
  const a = parseNum(existing)
  const b = parseNum(incoming)
  if (a == null && b == null) return null
  return (a ?? 0) + (b ?? 0)
}

export function mergeDistinctTokens(existing: string | null | undefined, incoming: string | null | undefined): string {
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

export function pickLaterOilLossDate(a: string | null, b: string | null): string | null {
  const sa = String(a ?? '').slice(0, 10)
  const sb = String(b ?? '').slice(0, 10)
  if (!sa) return sb || null
  if (!sb) return sa || null
  return sa >= sb ? sa : sb
}

/** Inner (contract-level) group key — prefer contract_number, fall back to contract_ext_no / row id. */
export function oilLossContractGroupKey(
  row: Pick<OilLossSourceRow, 'id' | 'contract_number' | 'contract_ext_no'>,
): string {
  const cn = String(row.contract_number ?? '').trim()
  if (cn) return `cn:${cn}`
  const ext = String(row.contract_ext_no ?? '').trim()
  if (ext) return `ext:${ext}`
  return `row:${row.id}`
}

export function isSeaOilLossTransportMode(mode: string | null | undefined): boolean {
  return String(mode ?? '').trim().toUpperCase() === 'SEA'
}

/**
 * Outer group key derived from an already-known inner (contract-level) key: SEA rows sharing
 * one STO/voyage Operation ID merge onto `op:{operationId}`; LAND (and SEA rows with no
 * resolvable Operation ID) stay at the given inner key, matching today's behavior exactly.
 */
export function oilLossOuterGroupKeyFromInner(
  innerKey: string,
  row: Pick<OilLossSourceRow, 'transport_mode' | 'operation_id'>,
): string {
  if (isSeaOilLossTransportMode(row.transport_mode)) {
    const opId = String(row.operation_id ?? '').trim()
    if (opId) return `op:${opId}`
  }
  return innerKey
}

/** Convenience: derive the outer group key directly from a raw row. */
export function oilLossOuterGroupKey(
  row: Pick<OilLossSourceRow, 'id' | 'contract_number' | 'contract_ext_no' | 'transport_mode' | 'operation_id'>,
): string {
  return oilLossOuterGroupKeyFromInner(oilLossContractGroupKey(row), row)
}

/* --------------------------------------------------------------------------------------- */
/* Quantity-only two-level aggregation — used for R1–R4 sample computation (Section 1).     */
/* --------------------------------------------------------------------------------------- */

export type OilLossQuantityAgg = {
  quantity_sent: number
  quantity_received: number
  quantity_sfal: number
  quantity_sfbd: number
  has_sent: boolean
  has_received: boolean
  has_sfal: boolean
  has_sfbd: boolean
}

type ContractQuantityAgg = OilLossQuantityAgg & {
  contract_key: string
  transport_mode: string | null
  operation_id: string | null
}

function emptyQuantityAgg(): OilLossQuantityAgg {
  return {
    quantity_sent: 0,
    quantity_received: 0,
    quantity_sfal: 0,
    quantity_sfbd: 0,
    has_sent: false,
    has_received: false,
    has_sfal: false,
    has_sfbd: false,
  }
}

/** Level 1 — per-contract subtotal (unchanged from pre-existing behavior). */
export function aggregateOilLossQuantitiesByContract(rows: OilLossSourceRow[]): Map<string, ContractQuantityAgg> {
  const map = new Map<string, ContractQuantityAgg>()

  for (const row of rows) {
    const key = oilLossContractGroupKey(row)
    let agg = map.get(key)
    if (!agg) {
      agg = {
        ...emptyQuantityAgg(),
        contract_key: key,
        transport_mode: row.transport_mode ?? null,
        operation_id: row.operation_id ?? null,
      }
      map.set(key, agg)
    }
    const delivery = parseNum(row.quantity_sent ?? row.quantity_delivery)
    const receive = parseNum(row.quantity_received)
    const sfal = parseNum(row.quantity_sfal)
    const sfbd = parseNum(row.quantity_sfbd)
    // Contracts-level delivery/receive — take once per contract (do not sum SPD rows).
    if (delivery != null && !agg.has_sent) {
      agg.quantity_sent = delivery
      agg.has_sent = true
    }
    if (receive != null && !agg.has_received) {
      agg.quantity_received = receive
      agg.has_received = true
    }
    if (sfal != null) {
      agg.quantity_sfal += sfal
      agg.has_sfal = true
    }
    if (sfbd != null) {
      agg.quantity_sfbd += sfbd
      agg.has_sfbd = true
    }
  }

  return map
}

/**
 * Level 2 — combine per-contract subtotals onto their outer group (SEA voyage or LAND contract).
 * Summing is correct here: each input is already one deduped subtotal per distinct contract, so
 * merging distinct contracts never double-counts.
 */
export function aggregateContractsByOuterGroup(
  byContract: Map<string, ContractQuantityAgg>,
): Map<string, OilLossQuantityAgg> {
  const outer = new Map<string, OilLossQuantityAgg>()

  for (const agg of byContract.values()) {
    const key = oilLossOuterGroupKeyFromInner(agg.contract_key, agg)
    let out = outer.get(key)
    if (!out) {
      out = emptyQuantityAgg()
      outer.set(key, out)
    }
    if (agg.has_sent) {
      out.quantity_sent += agg.quantity_sent
      out.has_sent = true
    }
    if (agg.has_received) {
      out.quantity_received += agg.quantity_received
      out.has_received = true
    }
    if (agg.has_sfal) {
      out.quantity_sfal += agg.quantity_sfal
      out.has_sfal = true
    }
    if (agg.has_sfbd) {
      out.quantity_sfbd += agg.quantity_sfbd
      out.has_sfbd = true
    }
  }

  return outer
}

/** Convenience: rows -> two-level (contract-then-voyage) quantity groups in one call. */
export function aggregateOilLossQuantitiesByOuterGroup(rows: OilLossSourceRow[]): Map<string, OilLossQuantityAgg> {
  return aggregateContractsByOuterGroup(aggregateOilLossQuantitiesByContract(rows))
}

/* --------------------------------------------------------------------------------------- */
/* Full merged-row aggregation — used by the "All Contract" view table and drilldown tree.  */
/* --------------------------------------------------------------------------------------- */

export type OilLossMergedRow = {
  id: string
  contract_date: string | null
  contract_ext_no: string | null
  contract_number: string | null
  po_number: string | null
  sto_number: string | null
  product: string | null
  incoterm: string | null
  group_plant: string | null
  plant_site: string | null
  group_name: string | null
  supplier: string | null
  buyer: string | null
  transporter: string | null
  transport_mode: string | null
  operation_id: string | null
  status: string | null
  quantity_contract: number | null
  quantity_delivery: number
  quantity_received: number
  quantity_sfal: number | null
  quantity_sfbd: number | null
  gain_loss_amount: number
  gain_loss_percentage: number
  row_count: number
  /** Distinct contracts/POs merged into this group (>1 only for a multi-PO SEA voyage). */
  contract_count: number
}

function computeGainLoss(delivery: number, received: number): { amount: number; pct: number } {
  const amount = received - delivery
  const pct = delivery > 0 ? Number(((amount / delivery) * 100).toFixed(4)) : 0
  return { amount, pct }
}

function mergedRowFromFirst(row: OilLossSourceRow, key: string): OilLossMergedRow {
  const delivery = parseNum(row.quantity_sent ?? row.quantity_delivery) ?? 0
  const received = parseNum(row.quantity_received) ?? 0
  const { amount, pct } = computeGainLoss(delivery, received)
  return {
    id: key,
    contract_date: String(row.contract_date ?? row.operation_date ?? '').slice(0, 10) || null,
    contract_ext_no: String(row.contract_ext_no ?? '').trim() || null,
    contract_number: String(row.contract_number ?? '').trim() || null,
    po_number: String(row.po_number ?? '').trim() || null,
    sto_number: String(row.sto_number ?? '').trim() || null,
    product: String(row.product ?? '').trim() || null,
    incoterm: String(row.incoterm ?? '').trim() || null,
    group_plant: String(row.group_plant ?? '').trim() || null,
    plant_site: String(row.plant_site ?? '').trim() || null,
    group_name: String(row.group_name ?? '').trim() || null,
    supplier: String(row.supplier ?? '').trim() || null,
    buyer: String(row.buyer ?? '').trim() || null,
    transporter: String(row.transporter ?? '').trim() || null,
    transport_mode: String(row.transport_mode ?? '').trim() || null,
    operation_id: String(row.operation_id ?? '').trim() || null,
    status: String(row.status ?? '').trim() || null,
    quantity_contract: parseNum(row.quantity_contract),
    quantity_delivery: delivery,
    quantity_received: received,
    quantity_sfal: parseNum(row.quantity_sfal),
    quantity_sfbd: parseNum(row.quantity_sfbd),
    gain_loss_amount: amount,
    gain_loss_percentage: pct,
    row_count: 1,
    contract_count: 1,
  }
}

function mergeSameContractRowInto(existing: OilLossMergedRow, row: OilLossSourceRow): void {
  const contractDate = String(row.contract_date ?? row.operation_date ?? '').slice(0, 10) || null
  existing.contract_date = pickLaterOilLossDate(existing.contract_date, contractDate)
  existing.contract_ext_no = mergeDistinctTokens(existing.contract_ext_no, row.contract_ext_no) || null
  existing.po_number = mergeDistinctTokens(existing.po_number, row.po_number) || null
  existing.sto_number = mergeDistinctTokens(existing.sto_number, row.sto_number) || null
  if (!existing.product) existing.product = String(row.product ?? '').trim() || null
  if (!existing.incoterm) existing.incoterm = String(row.incoterm ?? '').trim() || null
  if (!existing.group_plant) existing.group_plant = String(row.group_plant ?? '').trim() || null
  if (!existing.plant_site) existing.plant_site = String(row.plant_site ?? '').trim() || null
  if (!existing.group_name) existing.group_name = String(row.group_name ?? '').trim() || null
  if (!existing.status) existing.status = String(row.status ?? '').trim() || null
  if (!existing.supplier) existing.supplier = String(row.supplier ?? '').trim() || null
  if (!existing.buyer) existing.buyer = String(row.buyer ?? '').trim() || null
  if (!existing.transporter) existing.transporter = String(row.transporter ?? '').trim() || null

  const contractQty = parseNum(row.quantity_contract)
  if (contractQty != null) {
    existing.quantity_contract =
      existing.quantity_contract == null ? contractQty : Math.max(existing.quantity_contract, contractQty)
  }
  // Contracts-level delivery/receive — take once per contract (do not sum duplicate SPD rows);
  // existing.quantity_delivery/received are already resolved from the first row of this contract.
  existing.quantity_sfal = sumNullableOilLossQtyKg(existing.quantity_sfal, row.quantity_sfal)
  existing.quantity_sfbd = sumNullableOilLossQtyKg(existing.quantity_sfbd, row.quantity_sfbd)
  existing.row_count += 1
  const { amount, pct } = computeGainLoss(existing.quantity_delivery, existing.quantity_received)
  existing.gain_loss_amount = amount
  existing.gain_loss_percentage = pct
}

/** Level 1 — one merged row per contract (identical output to the pre-existing per-contract aggregation). */
function aggregateOilLossRowsByContract(rows: OilLossSourceRow[]): Map<string, OilLossMergedRow> {
  const map = new Map<string, OilLossMergedRow>()
  for (const row of rows) {
    const key = oilLossContractGroupKey(row)
    const existing = map.get(key)
    if (!existing) {
      map.set(key, mergedRowFromFirst(row, key))
      continue
    }
    mergeSameContractRowInto(existing, row)
  }
  return map
}

function mergeOuterGroupInto(existing: OilLossMergedRow, incoming: OilLossMergedRow, outerKey: string): void {
  existing.id = outerKey
  existing.contract_date = pickLaterOilLossDate(existing.contract_date, incoming.contract_date)
  existing.contract_ext_no = mergeDistinctTokens(existing.contract_ext_no, incoming.contract_ext_no) || null
  existing.contract_number = mergeDistinctTokens(existing.contract_number, incoming.contract_number) || null
  existing.po_number = mergeDistinctTokens(existing.po_number, incoming.po_number) || null
  existing.sto_number = mergeDistinctTokens(existing.sto_number, incoming.sto_number) || null
  if (!existing.product) existing.product = incoming.product
  if (!existing.incoterm) existing.incoterm = incoming.incoterm
  if (!existing.group_plant) existing.group_plant = incoming.group_plant
  if (!existing.plant_site) existing.plant_site = incoming.plant_site
  if (!existing.group_name) existing.group_name = incoming.group_name
  if (!existing.status) existing.status = incoming.status
  if (!existing.supplier) existing.supplier = incoming.supplier
  if (!existing.buyer) existing.buyer = incoming.buyer
  if (!existing.transporter) existing.transporter = incoming.transporter
  if (!existing.operation_id) existing.operation_id = incoming.operation_id

  if (incoming.quantity_contract != null) {
    existing.quantity_contract =
      existing.quantity_contract == null
        ? incoming.quantity_contract
        : existing.quantity_contract + incoming.quantity_contract
  }
  // Distinct contracts sharing one voyage — sum (never re-sums the same contract twice).
  existing.quantity_delivery += incoming.quantity_delivery
  existing.quantity_received += incoming.quantity_received
  existing.quantity_sfal = sumNullableOilLossQtyKg(existing.quantity_sfal, incoming.quantity_sfal)
  existing.quantity_sfbd = sumNullableOilLossQtyKg(existing.quantity_sfbd, incoming.quantity_sfbd)
  existing.row_count += incoming.row_count
  existing.contract_count += incoming.contract_count
  const { amount, pct } = computeGainLoss(existing.quantity_delivery, existing.quantity_received)
  existing.gain_loss_amount = amount
  existing.gain_loss_percentage = pct
}

/**
 * Two-level mode-aware aggregation: rows -> one merged row per contract (level 1), then
 * per-contract subtotals sharing a SEA voyage Operation ID merge into one row (level 2, summed).
 * LAND rows are unaffected (their outer key already equals their contract key).
 */
export function aggregateOilLossRowsByGroup(rows: OilLossSourceRow[]): OilLossMergedRow[] {
  const byContract = aggregateOilLossRowsByContract(rows)
  const byGroup = new Map<string, OilLossMergedRow>()

  for (const [contractKey, contractRow] of byContract) {
    const outerKey = oilLossOuterGroupKeyFromInner(contractKey, contractRow)
    const existing = byGroup.get(outerKey)
    if (!existing) {
      byGroup.set(outerKey, { ...contractRow, id: outerKey })
      continue
    }
    mergeOuterGroupInto(existing, contractRow, outerKey)
  }

  return [...byGroup.values()]
}
