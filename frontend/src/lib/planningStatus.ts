/**
 * Planning Status, shared by Contract Performance and Shipping Performance.
 *
 * Two values, as agreed on 2026-09-24:
 *
 *   Unplanned  nothing scheduled yet
 *   Planned    scheduled and still running — up to but not including completed, never cancelled
 *
 * A finished contract belongs to neither, which is why selecting both values is the same as
 * selecting none: `Planned OR Unplanned` would quietly drop every completed row.
 */

export const PLANNING_STATUS_OPTIONS = ['Unplanned', 'Planned'] as const

export type PlanningStatusOption = (typeof PLANNING_STATUS_OPTIONS)[number]

/** The API takes the uppercase form; the UI shows the readable one. */
export function planningStatusToParam(value: string): string {
  return String(value ?? '').trim().toUpperCase()
}

/**
 * Selecting both is not a filter. Sending `PLANNED,UNPLANNED` would be harmless today because the
 * backend also treats a full selection as "no filter", but building the param that way invites a
 * future reader to assume the two cover everything.
 */
export function planningStatusParamValue(selected: string[]): string {
  const norm = [...new Set(selected.map(planningStatusToParam))].filter(
    (v) => v === 'PLANNED' || v === 'UNPLANNED',
  )
  return norm.length === 1 ? norm[0] : ''
}

const BADGE_CLASS: Record<string, string> = {
  PLANNED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  SAILED: 'bg-indigo-100 text-indigo-800',
  ARRIVED_LP: 'bg-indigo-100 text-indigo-800',
  UNPLANNED: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-600',
}

/**
 * Badge tone for a shipment or trucking status. The two vocabularies differ — trucking never
 * reports PLANNED, it goes straight to IN_PROGRESS — so both are mapped to the same tone rather
 * than asking the caller which column it is rendering.
 */
export function planningStatusBadgeClass(status: string | null | undefined): string {
  const key = String(status ?? '').trim().toUpperCase()
  return BADGE_CLASS[key] ?? 'bg-gray-100 text-gray-600'
}
