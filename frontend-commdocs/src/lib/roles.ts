import type { Role } from './types'

/** How a role is shown anywhere in the app: its name in capitals (the display name, or the code when there is none). */
export function roleLabel(role: Pick<Role, 'role_name' | 'display_name'>): string {
  return (String(role.display_name ?? '').trim() || String(role.role_name ?? '').trim()).toUpperCase()
}
