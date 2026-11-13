/**
 * A master table cell that holds several values (a Site's companies, a Company's sites, a port's SAP names).
 * The table shows ONE pill with the count ("20 companies"); a click opens a dialog with the full list, A-Z. Pure rules here, so they are tested without the page.
 */

/**
 * What a value is sorted by: the name without its legal prefix. "PT. KPBN" sorts as K, "PT ENERGI OLEO PERSADA" as E, so a list of companies reads in the order
 * a person would look for them. Only the word PT is dropped ("PTPN III" keeps its P), and only at the start.
 */
export function multiValueSortKey(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/^PT\b\.?\s*/i, '')
    .toLowerCase()
}

/** Trim, drop empties and repeats (case-insensitive), and sort A-Z ignoring the PT prefix; equal keys fall back to the full text so the order is stable. */
export function sortMultiValues(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const v = String(raw ?? '').trim()
    if (!v || v === '-') continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out.sort((a, b) => {
    const byKey = multiValueSortKey(a).localeCompare(multiValueSortKey(b), undefined, { numeric: true, sensitivity: 'base' })
    return byKey !== 0 ? byKey : a.localeCompare(b)
  })
}

/**
 * The values of a cell: the list the API sent, or, for an older response without one, the text split on ";" and ",". Splitting is only the fallback because a
 * company name can hold a comma ("PT. FOO, TBK"): the API sends the list so that name is not cut in two.
 */
export function multiValuesOf(list: ReadonlyArray<string | null | undefined> | null | undefined, text?: string | null): string[] {
  if (Array.isArray(list)) return sortMultiValues(list)
  return sortMultiValues(String(text ?? '').split(/\s*[;,]\s*/))
}

/** The sorted values joined as text: what the column sorts and searches by. "-" when there are none. */
export function multiValueText(values: readonly string[]): string {
  return values.length ? values.join(', ') : '-'
}

/** "20 companies", "2 sites" (the singular never shows: one value is shown as itself). */
export function multiValuePillLabel(count: number, plural: string): string {
  return `${count} ${plural}`
}

/** The dialog's search: case-insensitive, and the PT prefix does not have to be typed. */
export function filterMultiValues(values: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...values]
  const bare = multiValueSortKey(q)
  return values.filter((v) => v.toLowerCase().includes(q) || (bare && multiValueSortKey(v).includes(bare)))
}
