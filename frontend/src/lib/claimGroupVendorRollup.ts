/** How many Group Vendor rows the claim recap shows. */
export const TOP_GROUP_VENDOR_ROWS = 5

export type GroupVendorSourceRow = {
  group_vendor: string | null
  vendor: string
  product: string
  qty_claim: number
  amount_after_tax_idr: number
}

export type GroupVendorChild = {
  vendor: string
  products: string[]
  qty_claim: number
  amount_after_tax_idr: number
}

export type GroupVendorRollup = {
  key: string
  label: string
  products: string[]
  qty_claim: number
  amount_after_tax_idr: number
  vendors: GroupVendorChild[]
}

function num(value: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function isBlankProduct(value: string): boolean {
  const s = value.trim()
  return !s || s === '-' || s === '(Blank)'
}

function addProduct(list: string[], product: string) {
  if (isBlankProduct(product)) return
  const name = product.trim()
  if (!list.includes(name)) list.push(name)
}

function byAmountDesc(a: { amount_after_tax_idr: number; qty_claim: number }, b: { amount_after_tax_idr: number; qty_claim: number }): number {
  const amount = num(b.amount_after_tax_idr) - num(a.amount_after_tax_idr)
  if (amount !== 0) return amount
  return num(b.qty_claim) - num(a.qty_claim)
}

/**
 * One row per Group Vendor, largest Amount After Tax first, capped at five.
 * Vendor lines under a group keep their own products and totals so the row can expand.
 * An unmapped group stays in the ranking as "-".
 */
export function topGroupVendorRollups(rows: GroupVendorSourceRow[]): GroupVendorRollup[] {
  const groups = new Map<string, GroupVendorRollup & { vendorMap: Map<string, GroupVendorChild> }>()
  for (const row of rows) {
    const label = String(row.group_vendor ?? '').trim() || '-'
    const key = label.toUpperCase()
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        label,
        products: [],
        qty_claim: 0,
        amount_after_tax_idr: 0,
        vendors: [],
        vendorMap: new Map(),
      }
      groups.set(key, group)
    }
    const vendorName = String(row.vendor ?? '').trim() || '-'
    const vendorKey = vendorName.toUpperCase()
    let child = group.vendorMap.get(vendorKey)
    if (!child) {
      child = { vendor: vendorName, products: [], qty_claim: 0, amount_after_tax_idr: 0 }
      group.vendorMap.set(vendorKey, child)
    }
    addProduct(group.products, row.product)
    addProduct(child.products, row.product)
    const qty = num(row.qty_claim)
    const amount = num(row.amount_after_tax_idr)
    group.qty_claim += qty
    group.amount_after_tax_idr += amount
    child.qty_claim += qty
    child.amount_after_tax_idr += amount
  }

  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      label: group.label,
      products: group.products,
      qty_claim: group.qty_claim,
      amount_after_tax_idr: group.amount_after_tax_idr,
      vendors: [...group.vendorMap.values()].sort(byAmountDesc),
    }))
    .sort((a, b) => byAmountDesc(a, b) || a.label.localeCompare(b.label))
    .slice(0, TOP_GROUP_VENDOR_ROWS)
}

export function formatProductList(products: string[]): string {
  return products.length > 0 ? products.join(', ') : '-'
}
