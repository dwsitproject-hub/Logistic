/** Shared helpers for compact-table column layout migrations (dedupe + default visibility). */

export function dedupeColumnIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function remapColumnIds(ids: readonly string[], remap: Readonly<Record<string, string>>): string[] {
  return ids.map((id) => remap[id] ?? id)
}

export function stripColumnIds(ids: readonly string[], obsolete: ReadonlySet<string>): string[] {
  return ids.filter((id) => !obsolete.has(id))
}

export function ensureColumnIdsPresent(ids: readonly string[], required: readonly string[]): string[] {
  const set = new Set(ids)
  const out = [...ids]
  for (const id of required) {
    if (!set.has(id)) {
      out.push(id)
      set.add(id)
    }
  }
  return out
}

/**
 * Preserve the user's saved column order. Append any missing ids from
 * {@link fallbackOrder} (or {@link allIds}) without reshuffling saved positions.
 */
export function mergePreservedColumnOrder(
  saved: readonly string[],
  allIds: readonly string[],
  fallbackOrder?: readonly string[],
): string[] {
  const known = new Set(allIds)
  const canonical = (fallbackOrder && fallbackOrder.length > 0 ? fallbackOrder : allIds).filter((id) =>
    known.has(id),
  )
  if (saved.length === 0) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of canonical) {
      if (!seen.has(id)) {
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

  const seen = new Set<string>()
  const out: string[] = []
  for (const id of saved) {
    if (known.has(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of canonical) {
    if (!seen.has(id)) {
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

export function migrateSavedColumnLayout(input: {
  visibleColumnIds: readonly string[]
  columnOrderIds: readonly string[]
  obsoleteColumnIds?: readonly string[]
  idRemap?: Readonly<Record<string, string>>
  ensureVisibleIds?: readonly string[]
}): { visibleColumnIds: string[]; columnOrderIds: string[] } {
  const obsolete = new Set(input.obsoleteColumnIds ?? [])
  let visible = remapColumnIds(input.visibleColumnIds, input.idRemap ?? {})
  let order = remapColumnIds(input.columnOrderIds, input.idRemap ?? {})
  visible = stripColumnIds(visible, obsolete)
  order = stripColumnIds(order, obsolete)
  visible = dedupeColumnIds(visible)
  order = dedupeColumnIds(order)
  if (input.ensureVisibleIds?.length) {
    visible = dedupeColumnIds(ensureColumnIdsPresent(visible, input.ensureVisibleIds))
  }
  return { visibleColumnIds: visible, columnOrderIds: order }
}
