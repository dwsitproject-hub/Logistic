import { typeLabel } from './documentTypes'
import type { AuditEntry } from './types'

/** The entity types this app's audit trail shows: its documents, and the accounts and roles it manages. */
export const AUDIT_ENTITY_TYPES = ['COMMERCIAL_DOCUMENT', 'USER', 'ROLE', 'ROLE_PERMISSIONS']

export type AuditGroup = 'all' | 'uploaded' | 'viewed' | 'downloaded' | 'deleted' | 'signin' | 'access'

export const AUDIT_GROUPS: Array<[AuditGroup, string]> = [
  ['all', 'All actions'],
  ['uploaded', 'Uploaded'],
  ['viewed', 'Viewed'],
  ['downloaded', 'Downloaded'],
  ['deleted', 'Deleted documents'],
  ['signin', 'Sign-ins'],
  ['access', 'User & access changes'],
]

/** The API filter (action list AND entity type list) behind each group. */
export function auditGroupFilter(group: AuditGroup): { action?: string[]; entityType: string[] } {
  const doc = ['COMMERCIAL_DOCUMENT']
  switch (group) {
    case 'uploaded':
      return { action: ['UPLOAD'], entityType: doc }
    case 'viewed':
      return { action: ['VIEW'], entityType: doc }
    case 'downloaded':
      return { action: ['DOWNLOAD', 'DOWNLOAD_TANDA_TERIMA'], entityType: doc }
    case 'deleted':
      return { action: ['DELETE'], entityType: doc }
    case 'signin':
      return { action: ['LOGIN', 'SSO_LOGIN'], entityType: ['USER'] }
    case 'access':
      return {
        action: [
          'CREATE',
          'UPDATE',
          'DELETE',
          'USER_INVITED',
          'USER_INVITATION_RESENT',
          'USER_PASSWORD_RESET_SENT',
          'PASSWORD_RESET_REQUESTED',
          'PASSWORD_RESET',
          'ACCOUNT_ACTIVATED',
        ],
        entityType: ['USER', 'ROLE', 'ROLE_PERMISSIONS'],
      }
    default:
      return { entityType: AUDIT_ENTITY_TYPES }
  }
}

export type AuditTone = 'ok' | 'warn' | 'bad' | 'neutral'

type Described = { action: string; tone: AuditTone; what: string; details: string }

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))

/**
 * One audit row in words. `names` maps user / role ids to names when the viewer may load them (ADMIN); otherwise the id is
 * shown.
 */
export function describeAudit(e: AuditEntry, names: Record<string, string> = {}): Described {
  const a = e.after_data || {}
  const target = e.entity_id ? names[e.entity_id] || e.entity_id : ''
  if (e.entity_type === 'COMMERCIAL_DOCUMENT') {
    const po = str(a.po_number) || str(a.contract_ext_no)
    const file = str(a.file_name)
    const doc = a.document_type ? typeLabel(str(a.document_type)) : 'Document'
    const where = [po && `PO ${po}`, file].filter(Boolean).join(' · ')
    switch (e.action) {
      case 'UPLOAD':
        return { action: a.action_type === 'EDIT' ? 'Uploaded new version' : 'Uploaded', tone: 'ok', what: doc, details: where }
      case 'VIEW':
        return { action: 'Viewed', tone: 'neutral', what: doc, details: where }
      case 'DOWNLOAD':
        return { action: 'Downloaded', tone: 'neutral', what: doc, details: where }
      case 'DELETE':
        return { action: 'Deleted', tone: 'bad', what: doc, details: where }
      case 'DOWNLOAD_TANDA_TERIMA': {
        const list = Array.isArray(a.contract_ext_nos) ? (a.contract_ext_nos as unknown[]).map(str) : []
        return {
          action: 'Downloaded',
          tone: 'neutral',
          what: 'Tanda Terima',
          details: `${list.length} contract${list.length === 1 ? '' : 's'}${a.send_date ? ` · send date ${str(a.send_date)}` : ''}${
            list.length ? ` · ${list.slice(0, 3).join(', ')}${list.length > 3 ? ', …' : ''}` : ''
          }`,
        }
      }
    }
  }
  if (e.entity_type === 'USER') {
    switch (e.action) {
      case 'LOGIN':
      case 'SSO_LOGIN':
        return { action: 'Signed in', tone: 'neutral', what: e.full_name || e.username || target, details: e.action === 'SSO_LOGIN' ? 'Hub SSO' : 'Email/password' }
      case 'USER_INVITED':
        return { action: 'Invited user', tone: 'warn', what: target, details: str(a.email) }
      case 'USER_INVITATION_RESENT':
        return { action: 'Resent invitation', tone: 'warn', what: target, details: str(a.email) }
      case 'USER_PASSWORD_RESET_SENT':
        return { action: 'Sent reset link', tone: 'warn', what: target, details: str(a.email) }
      case 'PASSWORD_RESET_REQUESTED':
        return { action: 'Asked for reset link', tone: 'neutral', what: target, details: '' }
      case 'PASSWORD_RESET':
        return { action: 'Reset password', tone: 'neutral', what: target, details: '' }
      case 'ACCOUNT_ACTIVATED':
        return { action: 'Activated account', tone: 'ok', what: target, details: '' }
      case 'UPDATE':
        return { action: 'Changed user', tone: 'warn', what: target, details: changedFields(e) }
      case 'DELETE':
        return { action: 'Deactivated user', tone: 'bad', what: target, details: '' }
    }
  }
  if (e.entity_type === 'ROLE') {
    if (e.action === 'CREATE') return { action: 'Created role', tone: 'warn', what: str(a.role_name) || target, details: str(a.display_name) }
    if (e.action === 'UPDATE') return { action: 'Changed role', tone: 'warn', what: target, details: changedFields(e) }
  }
  if (e.entity_type === 'ROLE_PERMISSIONS') {
    return { action: 'Changed permissions', tone: 'warn', what: target, details: '' }
  }
  return { action: e.action, tone: 'neutral', what: [e.entity_type, target].filter(Boolean).join(' '), details: '' }
}

function changedFields(e: AuditEntry): string {
  const keys = Object.keys(e.before_data || e.after_data || {}).filter((k) => k !== 'app')
  return keys.length ? `Changed: ${keys.join(', ')}` : ''
}
