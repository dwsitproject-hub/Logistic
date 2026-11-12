/**
 * What the Users page shows about people: who is in which state, how the list is filtered, and the small facts a row needs.
 * Pure functions, so the rules are tested without the page.
 */

export interface DirectoryUser {
  id: string
  email: string
  full_name: string
  role: string
  level?: string
  transport_type?: string
  plant?: string
  plants?: string[]
  group_plants?: string[]
  products?: string[]
  is_active: boolean
  is_first_login: boolean
  department?: string
}

/** active = may sign in; pending = invited, has not set a password yet; inactive = switched off. */
export type UserStatus = 'active' | 'pending' | 'inactive'
export type UserStatusFilter = 'all' | UserStatus

export function userStatus(user: Pick<DirectoryUser, 'is_active' | 'is_first_login'>): UserStatus {
  if (!user.is_active) return 'inactive'
  return user.is_first_login ? 'pending' : 'active'
}

export interface UserFilters {
  search: string
  /** A role code (users.role); empty = every role. */
  role: string
  status: UserStatusFilter
}

export function filterDirectoryUsers<T extends DirectoryUser>(users: T[], filters: UserFilters): T[] {
  const needle = filters.search.trim().toLowerCase()
  return users.filter((user) => {
    if (filters.role && user.role !== filters.role) return false
    if (filters.status !== 'all' && userStatus(user) !== filters.status) return false
    if (!needle) return true
    return [user.full_name, user.email, user.department ?? ''].some((text) => text.toLowerCase().includes(needle))
  })
}

export function countUsersByRole(users: Array<Pick<DirectoryUser, 'role'>>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const user of users) counts[user.role] = (counts[user.role] ?? 0) + 1
  return counts
}

export interface UserSummary {
  total: number
  active: number
  pending: number
  inactive: number
}

export function summarizeUsers(users: Array<Pick<DirectoryUser, 'is_active' | 'is_first_login'>>): UserSummary {
  const out: UserSummary = { total: users.length, active: 0, pending: 0, inactive: 0 }
  for (const user of users) out[userStatus(user)] += 1
  return out
}

/** "Siti Rahma" -> "SR"; one word -> its first two letters; an empty name falls back to the e-mail. */
export function userInitials(name: string, email = ''): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (email.trim()[0] ?? '?').toUpperCase()
}

/** The Region/Plant names a user is scoped to, whichever of the three fields the API filled. */
export function userRegionPlants(user: Pick<DirectoryUser, 'group_plants' | 'plants' | 'plant'>): string[] {
  if (user.group_plants?.length) return user.group_plants
  if (user.plants?.length) return user.plants
  return user.plant
    ? user.plant
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : []
}

const ROLE_TONES: Record<string, string> = {
  ADMIN: 'bg-violet-50 text-violet-700',
  TRADING: 'bg-blue-50 text-blue-700',
  LOGISTICS: 'bg-emerald-50 text-emerald-700',
  FINANCE: 'bg-amber-50 text-amber-800',
  MANAGEMENT: 'bg-fuchsia-50 text-fuchsia-700',
  SUPPORT: 'bg-slate-100 text-slate-700',
  ADMIN_SUPPORT: 'bg-orange-50 text-orange-700',
}
const FALLBACK_TONES = [
  'bg-cyan-50 text-cyan-700',
  'bg-rose-50 text-rose-700',
  'bg-lime-50 text-lime-800',
  'bg-indigo-50 text-indigo-700',
  'bg-teal-50 text-teal-700',
  'bg-pink-50 text-pink-700',
]

/** Chip colours for a role: the long-standing roles keep theirs, a role created later gets a stable one from its code. */
export function roleToneClass(role: string): string {
  const known = ROLE_TONES[role]
  if (known) return known
  let hash = 0
  for (const ch of role) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK_TONES[hash % FALLBACK_TONES.length]
}
