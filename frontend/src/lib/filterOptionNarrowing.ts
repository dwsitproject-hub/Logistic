/**
 * Narrow a filter's option list to the values the table actually has.
 *
 * THE TRAP THIS AVOIDS. A value the user has already picked must stay in the list even when the
 * other filters leave no row carrying it - otherwise the option disappears while still filtering,
 * and there is no way to untick it. The page would look stuck with no way out. So the offered list
 * is always "available, plus whatever is currently selected".
 *
 * `available` is null until the API answers. Until then nothing is narrowed: showing the full list
 * briefly is honest, while showing an empty one would make every dropdown look broken on load.
 */
export function narrowFilterOptions(
  all: readonly string[],
  available: readonly string[] | null | undefined,
  selected: readonly string[],
): string[] {
  if (!available) return [...all]
  const keep = new Set(available.map(normalizeOptionKey))
  for (const value of selected) keep.add(normalizeOptionKey(value))
  return all.filter((option) => keep.has(normalizeOptionKey(option)))
}

function normalizeOptionKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

/**
 * The same narrowing for a list that IS the source of truth rather than a fixed catalogue - a
 * supplier list fetched from the API, say. Values the table has but the catalogue does not are
 * kept, because the catalogue is the incomplete one in that direction.
 */
export function mergeFilterOptions(
  available: readonly string[] | null | undefined,
  selected: readonly string[],
): string[] | null {
  if (!available) return null
  const out = [...available]
  const seen = new Set(available.map(normalizeOptionKey))
  for (const value of selected) {
    if (!seen.has(normalizeOptionKey(value))) {
      out.push(value)
      seen.add(normalizeOptionKey(value))
    }
  }
  return out.sort((a, b) => a.localeCompare(b))
}
