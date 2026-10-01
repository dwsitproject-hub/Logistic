'use client'

import { useEffect, useMemo, useState } from 'react'

export type ListColumnDef = {
  id: string
  label: string
  defaultVisible?: boolean
}

type StoredLayout = {
  order: string[]
  visible: string[]
}

function readLayout(storageKey: string): StoredLayout | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredLayout
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.visible)) return null
    return parsed
  } catch {
    return null
  }
}

export function reorderColumnIds(ids: readonly string[], dragId: string, dropId: string): string[] {
  if (dragId === dropId) return [...ids]
  const next = [...ids]
  const from = next.indexOf(dragId)
  const to = next.indexOf(dropId)
  if (from < 0 || to < 0) return next
  next.splice(from, 1)
  next.splice(to, 0, dragId)
  return next
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function mergeIds(saved: readonly string[], allIds: readonly string[]): string[] {
  const known = new Set(allIds)
  const kept = saved.filter((id) => known.has(id))
  const missing = allIds.filter((id) => !kept.includes(id))
  return [...kept, ...missing]
}

/** Keep a saved hide/show choice, and show columns that were added after that layout was saved. */
function visibleIdsFromStored(
  stored: StoredLayout | null,
  allIds: readonly string[],
  defaultVisible: readonly string[],
): string[] {
  if (!stored) return [...defaultVisible]
  const known = new Set(allIds)
  const savedOrder = new Set(stored.order)
  const visible = stored.visible.filter((id) => known.has(id))
  const added = defaultVisible.filter((id) => known.has(id) && !savedOrder.has(id) && !visible.includes(id))
  return [...visible, ...added]
}

export function useListColumnLayout(storageKey: string, columns: readonly ListColumnDef[]) {
  const allIds = useMemo(() => columns.map((col) => col.id), [columns])
  const defaultVisible = useMemo(
    () => columns.filter((col) => col.defaultVisible !== false).map((col) => col.id),
    [columns],
  )
  const labelById = useMemo(() => new Map(columns.map((col) => [col.id, col.label])), [columns])

  const allIdsKey = allIds.join('\u0001')
  const defaultVisibleKey = defaultVisible.join('\u0001')
  // Server and the first client render must match. Saved layout is applied after mount.
  const [orderIds, setOrderIds] = useState<string[]>(() => [...allIds])
  const [visibleIds, setVisibleIds] = useState<string[]>(() => [...defaultVisible])
  const [layoutReady, setLayoutReady] = useState(false)
  const [dragColId, setDragColId] = useState<string | null>(null)

  useEffect(() => {
    const ids = allIdsKey ? allIdsKey.split('\u0001') : []
    const defaults = defaultVisibleKey ? defaultVisibleKey.split('\u0001') : []
    const stored = readLayout(storageKey)
    const nextOrder = stored ? mergeIds(stored.order, ids) : [...ids]
    const nextVisible = visibleIdsFromStored(stored, ids, defaults)
    setOrderIds((prev) => (sameIds(prev, nextOrder) ? prev : nextOrder))
    setVisibleIds((prev) => (sameIds(prev, nextVisible) ? prev : nextVisible))
    setLayoutReady(true)
  }, [storageKey, allIdsKey, defaultVisibleKey])

  useEffect(() => {
    if (!layoutReady) return
    localStorage.setItem(storageKey, JSON.stringify({ order: orderIds, visible: visibleIds }))
  }, [layoutReady, storageKey, orderIds, visibleIds])

  const orderedVisibleIds = useMemo(
    () => orderIds.filter((id) => visibleIds.includes(id)),
    [orderIds, visibleIds],
  )

  const menuColumns = useMemo(() => {
    const byId = new Map(columns.map((col) => [col.id, col]))
    const visibleSet = new Set(visibleIds)
    const visible = orderIds
      .filter((id) => visibleSet.has(id))
      .map((id) => byId.get(id))
      .filter((col): col is ListColumnDef => Boolean(col))
    const hidden = columns
      .filter((col) => !visibleSet.has(col.id))
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
    return [...visible, ...hidden]
  }, [columns, orderIds, visibleIds])

  const reorder = (dragId: string, dropId: string) => {
    setOrderIds((prev) => reorderColumnIds(mergeIds(prev, allIds), dragId, dropId))
  }

  const toggle = (id: string) => {
    setVisibleIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  const selectAll = () => setVisibleIds([...allIds])
  const unselectAll = () => setVisibleIds([])
  const reset = () => {
    setOrderIds([...allIds])
    setVisibleIds([...defaultVisible])
  }

  return {
    orderIds,
    visibleIds,
    orderedVisibleIds,
    menuColumns,
    dragColId,
    setDragColId,
    reorder,
    toggle,
    selectAll,
    unselectAll,
    reset,
    labelById,
  }
}
