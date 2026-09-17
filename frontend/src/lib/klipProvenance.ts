/**
 * Did a KLIP user write this field, according to the data rather than a guess?
 *
 * Backed by `klip_edited_fields` (migration 167), which the save paths append to. Three states
 * matter and they must not be collapsed:
 *
 *   recorded    the column is listed - a user wrote it, full stop
 *   not listed  unknown. NOT "came from SAP": every row predating the marker is empty, and so is
 *               every row only SAP has ever touched
 *   no array    the endpoint did not send provenance at all
 *
 * Callers fall back to comparing against the SAP snapshot for the unknown cases, which is weaker
 * but is all the older rows can offer.
 */
export function klipEditedFieldSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()
  const out = new Set<string>()
  for (const entry of value) {
    const name = String(entry ?? '').trim()
    if (name) out.add(name)
  }
  return out
}

/** True only when the data records a KLIP user writing this column. */
export function isKlipEditedField(source: unknown, column: string): boolean {
  if (!column) return false
  if (source instanceof Set) return source.has(column)
  return klipEditedFieldSet(source).has(column)
}
