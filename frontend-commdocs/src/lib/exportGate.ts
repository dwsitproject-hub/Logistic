/**
 * When the Excel export may run. It pulls every matching PO (about 50 requests for the full list), so it needs a narrowed list:
 * a date range plus at least one other filter. This also stops an export of "everything" by accident (Ryan, 2026-11-06).
 */

export const EXPORT_MIN_FILTERS = 2

export type ExportGateInput = {
  /** A real date range is set: any preset except "All dates", or a custom range with both dates filled in. */
  dateSet: boolean
  /** Names of the other filters in use, e.g. 'Region/Plant', 'Incoterm', 'Product', 'Supplier', 'Search', 'Document card'. */
  others: string[]
}

export type ExportGate = { ok: boolean; count: number; hint: string }

export function exportGate({ dateSet, others }: ExportGateInput): ExportGate {
  const count = (dateSet ? 1 : 0) + others.length
  if (dateSet && others.length >= 1) return { ok: true, count, hint: '' }
  const choices = 'Region/Plant, Incoterm, Created by, Product, Supplier, a search, or a document card'
  if (!dateSet && others.length >= 1)
    return { ok: false, count, hint: 'To export, set the Contract date to a range (not "All dates"). Your other filter is already set.' }
  if (dateSet)
    return { ok: false, count, hint: `To export, add one more filter: ${choices}. The date range is already set.` }
  return { ok: false, count, hint: `To export, set the Contract date to a range (not "All dates") and add one more filter: ${choices}.` }
}
