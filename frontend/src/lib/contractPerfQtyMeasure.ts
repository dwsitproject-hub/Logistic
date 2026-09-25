/**
 * What the quantity on a Contract Performance drilldown card actually measures.
 *
 * It is not one measure. Section 1 shows Outstanding Qty on the Open card and Contract Qty on the
 * Close card, and the tree sums the same per-row choice - Outstanding for an Open contract,
 * Contract Qty for a Close one. That keeps the tree equal to the two cards added together, which is
 * the point, but it means the "All" figure combines two different quantities under one label.
 *
 * Seen in the field: Open 10,101 MT and Close 98,090 MT against a tree reading 108,191 MT. The
 * arithmetic is right and the label is silent about what was added.
 *
 * With a card selected there is only one measure and it can be named exactly. With neither, the
 * mixture is stated rather than left to be discovered.
 */
export type ContractPerfSummaryCardStatus = 'All' | 'Open' | 'Close'

export function contractPerfQtyMeasureLabel(status: ContractPerfSummaryCardStatus): string {
  if (status === 'Open') return 'Qty = Outstanding Qty (MT)'
  if (status === 'Close') return 'Qty = Contract Qty (MT)'
  return 'Qty = Outstanding Qty (Open) + Contract Qty (Close)'
}

/** True only when the figure mixes two measures - the case worth warning about on screen. */
export function contractPerfQtyMeasureIsMixed(status: ContractPerfSummaryCardStatus): boolean {
  return status !== 'Open' && status !== 'Close'
}
