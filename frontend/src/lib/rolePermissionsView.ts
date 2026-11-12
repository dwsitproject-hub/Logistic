/**
 * How the Roles page groups, orders and compares permission rows. Pure functions, so the unsaved-changes count is tested without the page.
 */

export interface PermissionRow {
  id: string
  permission_key: string
  permission_name: string
  description: string
  category: string
  can_view?: boolean
  can_create?: boolean
  can_edit?: boolean
  can_delete?: boolean
}

export type PermissionField = 'can_view' | 'can_create' | 'can_edit' | 'can_delete'

export const PERMISSION_ACTION_FIELDS: PermissionField[] = ['can_view', 'can_create', 'can_edit', 'can_delete']

const CATEGORY_ORDER = ['page', 'data', 'dashboard', 'action', 'other']

const CATEGORY_TITLES: Record<string, string> = {
  page: 'Pages',
  data: 'Data',
  dashboard: 'Dashboard widgets',
  action: 'Actions',
  other: 'Other',
}

export function categoryTitle(category: string): string {
  return CATEGORY_TITLES[category] ?? category
}

export function groupPermissionsByCategory<T extends Pick<PermissionRow, 'category'>>(perms: T[]): Record<string, T[]> {
  const grouped: Record<string, T[]> = {}
  for (const perm of perms) {
    const category = perm.category || 'other'
    ;(grouped[category] ??= []).push(perm)
  }
  return grouped
}

/** Page, Data, Dashboard widgets, Actions, Other first in that order, then any category the server adds. */
export function orderedCategories(grouped: Record<string, unknown[]>): string[] {
  const known = CATEGORY_ORDER.filter((c) => c in grouped)
  const extra = Object.keys(grouped)
    .filter((c) => !CATEGORY_ORDER.includes(c))
    .sort()
  return [...known, ...extra]
}

export function sortPermissionRows<T extends Pick<PermissionRow, 'permission_key' | 'permission_name'>>(perms: T[]): T[] {
  return [...perms].sort(
    (a, b) => a.permission_key.localeCompare(b.permission_key) || a.permission_name.localeCompare(b.permission_name),
  )
}

export function filterPermissionRows<T extends Pick<PermissionRow, 'permission_key' | 'permission_name' | 'description'>>(
  perms: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return perms
  return perms.filter((p) =>
    [p.permission_name, p.permission_key, p.description ?? ''].some((text) => text.toLowerCase().includes(needle)),
  )
}

export function isAllChecked(perm: PermissionRow): boolean {
  return PERMISSION_ACTION_FIELDS.every((field) => Boolean(perm[field]))
}

export function isAnyChecked(perm: PermissionRow): boolean {
  return PERMISSION_ACTION_FIELDS.some((field) => Boolean(perm[field]))
}

/** Permissions that have at least one action ticked. */
export function enabledPermissionCount(perms: PermissionRow[]): number {
  return perms.filter(isAnyChecked).length
}

/** How many permission rows differ from what was last loaded or saved (a row counts once, however many of its four boxes changed). */
export function countPermissionChanges(saved: PermissionRow[], current: PermissionRow[]): number {
  const before = new Map(saved.map((p) => [p.id, p]))
  let changed = 0
  for (const perm of current) {
    const was = before.get(perm.id)
    if (!was) {
      if (isAnyChecked(perm)) changed += 1
      continue
    }
    if (PERMISSION_ACTION_FIELDS.some((field) => Boolean(was[field]) !== Boolean(perm[field]))) changed += 1
  }
  return changed
}
