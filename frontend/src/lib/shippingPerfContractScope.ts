/**
 * Shipping Performance: let the toolbar filter CONTRACTS, not only STO rows.
 *
 * A STO row carries one value of product / supplier / group / source / incoterm / site (the picked
 * contract's, or a comma list), but can span contracts that differ in them. The toolbar filters
 * pick rows, so picking CPO kept a row with three CPO contracts and one POME contract and counted
 * the POME one too: BONTANG / CPO read 83,758 MT here against Contract Performance's 83,258.
 *
 * The backend therefore attaches `contract_scope` to the rows whose single values do not describe their
 * contracts: the contracts grouped by identical attributes, each group with the outstanding the row was
 * awarded for it. That is a row spanning CPO and POME contracts, but also one contract whose supplier is
 * not the one on the row (a relabelled B2B child).
 * `expandContractScopeRows` turns such a row into one scope row per group at the START of the
 * pipeline, so every filter, card and tree already in the page works on contracts without being
 * touched. `collapseContractScopeRows` puts the row back for everything that shows or counts STOs
 * (the table, By Vessel, vessel history), carrying only the outstanding of the groups that
 * survived the filters.
 *
 * A row without `contract_scope` passes through both functions untouched.
 */

export type ShippingPerfContractScopeGroup = {
  contract_number: string
  product: string | null
  incoterm: string | null
  source_type: string | null
  supplier: string | null
  group_name: string | null
  plant_site: string | null
  /** YYYY-MM-DD */
  contract_date: string | null
  /** What the row was awarded for exactly these contracts, in kg. */
  outstanding_qty_aggregate: number
}

type ScopeRowBase = {
  contract_scope?: ShippingPerfContractScopeGroup[] | null
  outstanding_qty_aggregate?: number | null
}

/** A row made from one group of a parent's contracts. */
export type ShippingPerfScopeRowFields<P> = { scope_parent?: P }

const GROUP_FIELDS = [
  'product',
  'incoterm',
  'source_type',
  'supplier',
  'group_name',
  'plant_site',
  'contract_date',
] as const

export function expandContractScopeRows<T extends ScopeRowBase & ShippingPerfScopeRowFields<T>>(
  rows: T[],
): T[] {
  const out: T[] = []
  for (const row of rows) {
    const groups = row.contract_scope
    if (!Array.isArray(groups) || groups.length < 1) {
      out.push(row)
      continue
    }
    for (const group of groups) {
      const scopeRow: T = { ...row, scope_parent: row }
      const target = scopeRow as unknown as Record<string, unknown>
      for (const field of GROUP_FIELDS) target[field] = group[field]
      target.contract_number = group.contract_number
      scopeRow.outstanding_qty_aggregate = group.outstanding_qty_aggregate
      out.push(scopeRow)
    }
  }
  return out
}

/** The STO row a scope row was made from (the row itself when it was never split). */
export function contractScopeParent<T extends ShippingPerfScopeRowFields<T>>(row: T): T {
  return row.scope_parent ?? row
}

/**
 * Back to one row per STO, in the order the rows first appear. A split row's outstanding is the sum
 * of its surviving groups, so a filter that keeps one product keeps only that product's outstanding.
 */
export function collapseContractScopeRows<T extends ScopeRowBase & ShippingPerfScopeRowFields<T>>(
  rows: T[],
): T[] {
  const kept = new Map<T, number>()
  const order: T[] = []
  for (const row of rows) {
    const parent = row.scope_parent
    if (!parent) {
      order.push(row)
      continue
    }
    if (!kept.has(parent)) order.push(parent)
    kept.set(parent, (kept.get(parent) ?? 0) + (Number(row.outstanding_qty_aggregate) || 0))
  }
  return order.map((row) => {
    const scoped = kept.get(row)
    if (scoped === undefined) return row
    return { ...row, outstanding_qty_aggregate: scoped }
  })
}

/** One entry per STO row, for counts and averages that must not weigh a split row twice. */
export function uniqueContractScopeParents<T extends ShippingPerfScopeRowFields<T>>(rows: T[]): T[] {
  const seen = new Set<T>()
  const out: T[] = []
  for (const row of rows) {
    const parent = contractScopeParent(row)
    if (seen.has(parent)) continue
    seen.add(parent)
    out.push(row)
  }
  return out
}
