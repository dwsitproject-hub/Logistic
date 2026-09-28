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

function mergeIds(saved: readonly string[], allIds: readonly string[]): string[] {
  const known = new Set(allIds)
  const kept = saved.filter((id) => known.has(id))
  const missing = allIds.filter((id) => !kept.includes(id))
  return [...kept, ...missing]
}

export function useListColumnLayout(storageKey: string, columns: readonly ListColumnDef[]) {
  const allIds = useMemo(() => columns.map((col) => col.id), [columns])
  const defaultVisible = useMemo(
    () => columns.filter((col) => col.defaultVisible !== false).map((col) => col.id),
    [columns],
  )
  const labelById = useMemo(() => new Map(columns.map((col) => [col.id, col.label])), [columns])

  const [orderIds, setOrderIds] = useState<string[]>(() => {
    const stored = readLayout(storageKey)
    return stored ? mergeIds(stored.order, allIds) : [...allIds]
  })
  const [visibleIds, setVisibleIds] = useState<string[]>(() => {
    const stored = readLayout(storageKey)
    return stored ? stored.visible.filter((id) => allIds.includes(id)) : [...defaultVisible]
  })
  const [dragColId, setDragColId] = useState<string | null>(null)

  useEffect(() => {
    setOrderIds((prev) => mergeIds(prev, allIds))
    setVisibleIds((prev) => prev.filter((id) => allIds.includes(id)))
  }, [allIds])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ order: orderIds, visible: visibleIds }))
  }, [storageKey, orderIds, visibleIds])

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
