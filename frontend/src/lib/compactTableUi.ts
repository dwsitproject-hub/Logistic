/**
 * Shared compact data-table UI — header word-breaking and minimum column widths.
 * Used by Contracts, Contract Performance, Shipments, Trucking, Shipping Performance, etc.
 */

/** text-xs header labels: wrap between words only, never mid-word. */
export const COMPACT_TABLE_HEADER_LABEL_CLASS = 'klip-compact-table-header-label leading-snug whitespace-normal'

export const COMPACT_TABLE_HEADER_ROW_CLASS =
  'text-xs font-semibold text-gray-600 bg-gray-50 border-b sticky top-0 z-10 klip-compact-table-header-row'

/** Operational / perf tables: sticky top on each th — not on tr (breaks Actions sticky-right). */
export const COMPACT_TABLE_HEADER_ROW_PERF_CLASS =
  'text-xs font-semibold text-gray-600 bg-gray-50 border-b klip-compact-table-header-row'

export const COMPACT_TABLE_HEADER_ROW_OPERATIONAL_CLASS = COMPACT_TABLE_HEADER_ROW_PERF_CLASS

/** Actions <th> only — sticky right + top corner cell (body <td> unchanged). */
export const COMPACT_TABLE_ACTIONS_HEADER_STICKY_CLASS = 'klip-op-col--actions-header'

export const COMPACT_TABLE_ACTIONS_COL_WIDTH_PX = 80

export const COMPACT_TABLE_ACTIONS_HEADER_CLASS =
  'klip-op-col--actions text-center align-middle font-semibold whitespace-nowrap px-4 py-1.5'

export const COMPACT_TABLE_ACTIONS_CELL_CLASS =
  'klip-op-col--actions align-middle text-center px-4 py-1.5'

export const COMPACT_TABLE_CLASS = 'w-full table-fixed border-collapse klip-compact-table'

/**
 * Shipments / Trucking list tables — auto column sizing from header min-width + cell content.
 * Headers stay compact; columns grow for long continuous tokens (PO, STO, Contract Ext No).
 */
/** width/max-content + min-width:100% come from globals.css — avoid Tailwind w-full override */
export const COMPACT_OPERATIONAL_TABLE_CLASS =
  'border-collapse klip-compact-table klip-compact-table--operational'

/** Shipments + Trucking — vertically center single-line cells when row height grows (multi contract/PO). */
export const COMPACT_OPERATIONAL_TABLE_ROW_VCENTER_CLASS = 'klip-compact-table--row-vcenter'

/** Horizontal scroll wrapper for Shipments / Trucking list tables */
export const COMPACT_OPERATIONAL_TABLE_SCROLL_CLASS = 'w-full min-w-0 overflow-x-auto'

export const COMPACT_OPERATIONAL_TABLE_CELL_CLASS = 'klip-compact-table-cell'

/** Block inner wrapper — allows multi-line wrap (replaces flex row on data cells). */
export const COMPACT_OPERATIONAL_TABLE_CELL_INNER_CLASS = 'klip-compact-table-cell-inner'

/** Approximate px per character at text-xs (12px) for header width estimates. */
const HEADER_CHAR_PX = 7
const CELL_HORIZONTAL_PAD_PX = 16
const SORT_CONTROL_PX = 22
const FORMULA_HELP_PX = 20

export function longestHeaderWordLength(label: string): number {
  const text = String(label).trim()
  if (!text) return 0
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return text.length
  return Math.max(...words.map((w) => w.length))
}

export function compactTableHeaderMinWidthPx(
  label: string,
  options?: { hasFormulaHelp?: boolean; hasSort?: boolean },
): number {
  const hasSort = options?.hasSort !== false
  const hasHelp = Boolean(options?.hasFormulaHelp)
  const longest = longestHeaderWordLength(label)
  let px = Math.ceil(longest * HEADER_CHAR_PX) + CELL_HORIZONTAL_PAD_PX
  if (hasSort) px += SORT_CONTROL_PX
  if (hasHelp) px += FORMULA_HELP_PX
  return px
}

/** Ensures configured width is at least wide enough for the longest header word. */
export function resolveCompactColumnWidthPx(
  basePx: number,
  headerLabel?: string,
  options?: { hasFormulaHelp?: boolean; hasSort?: boolean },
): number {
  if (!headerLabel?.trim()) return basePx
  return Math.max(basePx, compactTableHeaderMinWidthPx(headerLabel, options))
}

export function compactTableColumnTrackPx(px: number): string {
  return `minmax(${px}px, ${px}px)`
}

/** Parse minmax track or return fixed px for <col style={{ width }}>. */
export function compactTableColWidthCss(trackOrPx: string | number): string {
  if (typeof trackOrPx === 'number') return `${trackOrPx}px`
  const parsed = parseCompactTableTrackPx(trackOrPx)
  return parsed != null ? `${parsed}px` : trackOrPx
}

export type CompactTableColumnWidthInput = {
  id: string
  label?: string
  formulaHelp?: string
}

export function buildCompactTableColumnWidthTracks(
  visibleColumns: ReadonlyArray<string | CompactTableColumnWidthInput>,
  resolvePx: (id: string, label?: string, formulaHelp?: string) => number,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of visibleColumns) {
    if (typeof item === 'string') {
      const px = resolvePx(item)
      out[item] = compactTableColumnTrackPx(px)
      continue
    }
    const px = resolvePx(item.id, item.label, item.formulaHelp)
    out[item.id] = compactTableColumnTrackPx(px)
  }
  return out
}

export type CompactTableColumnMeta = {
  id: string
  label: string
  formulaHelp?: string
}

export function parseCompactTableTrackPx(track: string): number | null {
  const minmax = track.match(/minmax\((\d+)px/)
  if (minmax) return parseInt(minmax[1], 10)
  const fixed = track.match(/^(\d+)px$/)
  if (fixed) return parseInt(fixed[1], 10)
  return null
}

/**
 * Operational list tables (Contracts, Shipments, Trucking): use precomputed track when
 * available, otherwise base width + header longest-word minimum.
 */
export function resolveVisibleColumnWidthPx(
  col: CompactTableColumnMeta,
  options?: {
    baseWidthPx?: number
    precomputedTrack?: string
  },
): number {
  const fromTrack = options?.precomputedTrack
    ? parseCompactTableTrackPx(options.precomputedTrack)
    : null
  if (fromTrack != null) return fromTrack
  const base = options?.baseWidthPx ?? 96
  return resolveCompactColumnWidthPx(base, col.label, {
    hasFormulaHelp: Boolean(col.formulaHelp),
    hasSort: true,
  })
}

export function sumCompactTableColumnsWidthPx<T extends CompactTableColumnMeta>(
  columns: readonly T[],
  resolvePx: (col: T) => number,
  extraPx = 0,
): number {
  return columns.reduce((sum, col) => sum + resolvePx(col), 0) + extraPx
}
