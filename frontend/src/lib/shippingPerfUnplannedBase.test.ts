import { describe, expect, it } from 'vitest'

/**
 * The page's base filter drops UNPLANNED rows. The backlog arm the backend added emits exactly
 * that status, so for one deploy every backlog row was discarded on arrival and the drilldown sat
 * at 49,107 MT against Shipments' 80,939 MT for CPO / Bontang — the backend was right and the
 * number never moved.
 *
 * Two different things share one status and must not share one rule:
 *   UNPLANNED shipment  — a shipment record not yet scheduled. Excluded, as it always was.
 *   backlog row         — a contract with outstanding and NO shipment to schedule. Kept.
 *
 * This reproduces the predicate from page.tsx rather than importing it, because the page is a
 * client component that pulls in the whole dashboard. If the two ever diverge, the page is what
 * ships — so the assertion below is on the RULE, and any edit to it should be made here first.
 */
type Row = { status?: string | null; is_unplanned_backlog?: boolean | null }

const isUnplannedStatus = (s: string | null | undefined) =>
  String(s ?? '').trim().toUpperCase() === 'UNPLANNED'
const isBacklog = (row: Row) => row.is_unplanned_backlog === true
const keep = (rows: Row[]) => rows.filter((r) => isBacklog(r) || !isUnplannedStatus(r.status))

describe('Shipping Performance base filter vs the backlog arm', () => {
  it('keeps a backlog row even though its status is UNPLANNED', () => {
    expect(keep([{ status: 'UNPLANNED', is_unplanned_backlog: true }])).toHaveLength(1)
  })

  it('still drops an UNPLANNED shipment that is not backlog', () => {
    expect(keep([{ status: 'UNPLANNED' }])).toHaveLength(0)
    expect(keep([{ status: 'unplanned', is_unplanned_backlog: false }])).toHaveLength(0)
  })

  it('takes the flag from the backend and never infers it from the status', () => {
    // A row the backend did not mark is not backlog, whatever it looks like.
    expect(keep([{ status: ' UnPlAnNeD ', is_unplanned_backlog: null }])).toHaveLength(0)
  })

  it('leaves every other status untouched', () => {
    const rows: Row[] = [{ status: 'COMPLETED' }, { status: 'IN_TRANSIT' }, { status: null }]
    expect(keep(rows)).toHaveLength(3)
  })
})
