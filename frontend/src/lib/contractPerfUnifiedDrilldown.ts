/** Unified ALL | ON TIME | LATE segment metrics for Contract Performance drilldown cards. */

export type UnifiedPerfSegment = {
  count: number
  avgTradeDays: number | null
  totalQtyKg: number
}

export type UnifiedPerfNodeLevel = 'product' | 'plant' | 'incoterm' | 'supplier'

export type UnifiedPerfNode = {
  id: string
  label: string
  level: UnifiedPerfNodeLevel
  all: UnifiedPerfSegment
  onTime: UnifiedPerfSegment
  late: UnifiedPerfSegment
  children: UnifiedPerfNode[]
}

export type BranchNodeLike = {
  id: string
  label: string
  level: string
  count: number
  totalDays: number
  totalQtyDelivery: number
  children: BranchNodeLike[]
}

function emptySegment(): UnifiedPerfSegment {
  return { count: 0, avgTradeDays: null, totalQtyKg: 0 }
}

function segmentFromBranchNode(node: BranchNodeLike | null | undefined): UnifiedPerfSegment {
  if (!node || node.count <= 0) return emptySegment()
  return {
    count: node.count,
    avgTradeDays: node.totalDays / node.count,
    totalQtyKg: node.totalQtyDelivery,
  }
}

function mergeSegmentPair(
  onSeg: UnifiedPerfSegment,
  lateSeg: UnifiedPerfSegment,
): UnifiedPerfSegment {
  const count = onSeg.count + lateSeg.count
  if (count <= 0) return emptySegment()
  const totalDays =
    (onSeg.avgTradeDays ?? 0) * onSeg.count + (lateSeg.avgTradeDays ?? 0) * lateSeg.count
  return {
    count,
    avgTradeDays: totalDays / count,
    totalQtyKg: onSeg.totalQtyKg + lateSeg.totalQtyKg,
  }
}

function nextUnifiedLevel(level: UnifiedPerfNodeLevel): UnifiedPerfNodeLevel {
  if (level === 'product') return 'plant'
  if (level === 'plant') return 'incoterm'
  return 'supplier'
}

function mergeChildren(
  onNodes: BranchNodeLike[],
  lateNodes: BranchNodeLike[],
  level: UnifiedPerfNodeLevel,
): UnifiedPerfNode[] {
  const labelSet = new Set<string>()
  for (const n of onNodes) labelSet.add(n.label)
  for (const n of lateNodes) labelSet.add(n.label)

  const merged: UnifiedPerfNode[] = []
  for (const label of labelSet) {
    const onNode = onNodes.find((n) => n.label === label)
    const lateNode = lateNodes.find((n) => n.label === label)
    const onTime = segmentFromBranchNode(onNode)
    const late = segmentFromBranchNode(lateNode)
    const all = mergeSegmentPair(onTime, late)
    merged.push({
      id: onNode?.id ?? lateNode?.id ?? `${level}__${label}`,
      label,
      level,
      all,
      onTime,
      late,
      children: mergeChildren(onNode?.children ?? [], lateNode?.children ?? [], nextUnifiedLevel(level)),
    })
  }

  merged.sort(
    (a, b) =>
      b.all.totalQtyKg - a.all.totalQtyKg ||
      b.all.count - a.all.count ||
      a.label.localeCompare(b.label),
  )
  return merged
}

/** Merge On Time and Late branch trees into unified segment nodes (Product → … → Supplier). */
export function mergeUnifiedPerfBranchTrees(
  onTrackRoot: BranchNodeLike,
  lateRoot: BranchNodeLike,
): UnifiedPerfNode[] {
  return mergeChildren(onTrackRoot.children, lateRoot.children, 'product')
}

export function findUnifiedPerfNode(
  nodes: UnifiedPerfNode[],
  label: string | null | undefined,
): UnifiedPerfNode | null {
  if (!label) return null
  return nodes.find((n) => n.label === label) ?? null
}

export function formatUnifiedAvgTradeDays(days: number | null, segment: 'ALL' | 'ON_TIME' | 'LATE'): string {
  if (days == null || Number.isNaN(days)) return '—'
  return `${days.toFixed(1)} Days`
}

export function unifiedAvgTradeLabel(segment: 'ALL' | 'ON_TIME' | 'LATE'): string {
  if (segment === 'LATE') return 'Avg Trade Late'
  return 'Avg Trade Ahead'
}

export function unifiedQtyLabel(summaryCardStatus?: 'All' | 'Open' | 'Close'): string {
  if (summaryCardStatus === 'Open') return 'OS Qty'
  if (summaryCardStatus === 'Close') return 'Contract Qty'
  return 'Qty'
}
