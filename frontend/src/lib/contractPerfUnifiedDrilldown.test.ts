import { describe, expect, it } from 'vitest'
import { mergeUnifiedPerfBranchTrees, type BranchNodeLike } from './contractPerfUnifiedDrilldown'

function branch(overrides: Partial<BranchNodeLike> & { label: string }): BranchNodeLike {
  return {
    id: overrides.label,
    level: 'product',
    count: 0,
    totalDays: 0,
    totalQtyDelivery: 0,
    children: [],
    ...overrides,
  }
}

describe('mergeUnifiedPerfBranchTrees', () => {
  it('merges on-time and late counts per product node', () => {
    const onRoot = branch({
      label: 'Total',
      children: [
        branch({ label: 'CPO', count: 2, totalDays: 4, totalQtyDelivery: 1000, children: [] }),
      ],
    })
    const lateRoot = branch({
      label: 'Total',
      children: [
        branch({ label: 'CPO', count: 1, totalDays: 3, totalQtyDelivery: 500, children: [] }),
        branch({ label: 'PK', count: 1, totalDays: 2, totalQtyDelivery: 200, children: [] }),
      ],
    })

    const merged = mergeUnifiedPerfBranchTrees(onRoot, lateRoot)
    expect(merged).toHaveLength(2)

    const cpo = merged.find((n) => n.label === 'CPO')!
    expect(cpo.all.count).toBe(3)
    expect(cpo.onTime.count).toBe(2)
    expect(cpo.late.count).toBe(1)
    expect(cpo.all.totalQtyKg).toBe(1500)

    const pk = merged.find((n) => n.label === 'PK')!
    expect(pk.all.count).toBe(1)
    expect(pk.onTime.count).toBe(0)
    expect(pk.late.count).toBe(1)
  })
})
