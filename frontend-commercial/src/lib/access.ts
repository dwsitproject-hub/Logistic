import type { DocumentType } from './documentTypes'
import type { PermissionMap } from './types'

/**
 * What the signed-in user may see and do. Every rule mirrors the backend gate for the same action, so a button is shown exactly
 * when the API would accept the call:
 * - Documents: page.commercial_documents can_view (routes/commercialDocuments.routes.ts)
 * - Dashboard: page.commercial_dashboard can_view
 * - Upload <type>: can_create or can_edit on data.commercial_documents.upload.<type> (commercialDocuments.controller.ts)
 * - Delete a file: data.commercial_documents can_delete
 * - Users, Roles: role ADMIN (routes/user.routes.ts, role.routes.ts)
 * - Audit trail: role ADMIN / SUPPORT / ADMIN_SUPPORT (routes/audit.routes.ts)
 * ADMIN passes every permission check on the server, so it does here too.
 */

export type Access = {
  documents: boolean
  dashboard: boolean
  users: boolean
  roles: boolean
  audit: boolean
  deleteFiles: boolean
  upload: (type: DocumentType) => boolean
}

export const UPLOAD_PERMISSION_PREFIX = 'data.commercial_documents.upload.'

export function accessFor(role: string | null | undefined, permissions: PermissionMap): Access {
  const admin = role === 'ADMIN'
  const flag = (key: string, f: 'canView' | 'canCreate' | 'canEdit' | 'canDelete') => admin || Boolean(permissions[key]?.[f])
  return {
    documents: flag('page.commercial_documents', 'canView'),
    // The menu follows the role editor, as in KLIP. (The API also lets the Documents permission read completeness, only because
    // KLIP's Documents page prefetches it.)
    dashboard: flag('page.commercial_dashboard', 'canView'),
    users: admin,
    roles: admin,
    audit: admin || role === 'SUPPORT' || role === 'ADMIN_SUPPORT',
    deleteFiles: flag('data.commercial_documents', 'canDelete'),
    upload: (type) =>
      flag(`${UPLOAD_PERMISSION_PREFIX}${type}`, 'canCreate') || flag(`${UPLOAD_PERMISSION_PREFIX}${type}`, 'canEdit'),
  }
}

export type NavKey = 'documents' | 'dashboard' | 'users' | 'roles' | 'audit'

export const NAV: Array<{ key: NavKey; href: string; label: string; admin?: boolean }> = [
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard' },
  { key: 'documents', href: '/documents', label: 'Documents' },
  { key: 'users', href: '/users', label: 'Users', admin: true },
  { key: 'roles', href: '/roles', label: 'Roles & access', admin: true },
  { key: 'audit', href: '/audit', label: 'Audit trail', admin: true },
]

/** Where a user lands after signing in: Documents first (the daily work), else the first page they may open. */
export function homePath(access: Access): string | null {
  if (access.documents) return '/documents'
  const first = NAV.find((n) => access[n.key])
  return first ? first.href : null
}

/** The page a path belongs to, for the access check in the shell. */
export function navKeyForPath(pathname: string): NavKey | null {
  const hit = NAV.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))
  return hit ? hit.key : null
}
