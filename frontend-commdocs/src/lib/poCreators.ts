/**
 * The SAP ME2N report (Purchasing Document, Created by, ...) read into PO -> creator pairs, for the Dashboard's "by SAP creator" table.
 * One row of the report is one PO item, so a PO repeats; each PO keeps its first creator, and a PO that shows two creators is counted
 * in `conflicts` so the person loading the file is told.
 */

export type PoCreatorRow = { po_number: string; created_by: string }

export type PoCreatorsRead = {
  rows: PoCreatorRow[]
  /** Distinct creators found. */
  creators: number
  /** PO numbers that appear with more than one creator (the first one is kept). */
  conflicts: number
  /** Data rows without a PO number or a creator. */
  skipped: number
}

const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

/** The sheet as rows of cells (header: 1). Returns null when it has no "Purchasing Document" and "Created by" columns. */
export function readPoCreators(aoa: unknown[][]): PoCreatorsRead | null {
  const headerAt = aoa.findIndex((r) => (r || []).some((c) => key(c) === 'purchasingdocument') && (r || []).some((c) => key(c) === 'createdby'))
  if (headerAt < 0) return null
  const header = aoa[headerAt] || []
  const poCol = header.findIndex((c) => key(c) === 'purchasingdocument')
  const byCol = header.findIndex((c) => key(c) === 'createdby')

  const first = new Map<string, string>()
  let conflicts = 0
  let skipped = 0
  const seenConflict = new Set<string>()
  for (let i = headerAt + 1; i < aoa.length; i++) {
    const r = aoa[i] || []
    const po = text(r[poCol])
    const by = text(r[byCol])
    if (!po && !by) continue
    if (!po || !by) {
      skipped += 1
      continue
    }
    const known = first.get(po)
    if (known === undefined) first.set(po, by)
    else if (known !== by && !seenConflict.has(po)) {
      seenConflict.add(po)
      conflicts += 1
    }
  }
  const rows = [...first.entries()].map(([po_number, created_by]) => ({ po_number, created_by }))
  return { rows, creators: new Set(rows.map((r) => r.created_by)).size, conflicts, skipped }
}
