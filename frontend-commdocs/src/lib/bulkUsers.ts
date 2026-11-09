import { roleLabel } from './roles'
import type { Role } from './types'

/**
 * Adding users from an Excel file (Users page > Bulk upload). Parsing and checking live here, away from the screen, so they can be tested.
 * The checks mirror the single "Add user" form and the API (POST /users): a row that passes here is one the API accepts, apart from
 * races such as an e-mail added by someone else a moment ago.
 */

export const BULK_HEADERS = ['Full name', 'Email', 'Role', 'Level', 'Transport type', 'Region/Plant'] as const
export const BULK_LEVELS = ['Staff', 'Section Head', 'Dept Head', 'Admin']
export const BULK_TRANSPORT = ['SEA', 'LAND', 'ALL', 'MIX']
/** One upload adds at most this many users, so a wrong file cannot mail hundreds of invitations. */
export const MAX_BULK_ROWS = 200
/** A LOGISTICS user at these levels must have a transport type (same rule as the form and the API). */
const TRANSPORT_LEVELS = ['Section Head', 'Staff', 'Admin']

export type BulkRow = {
  /** The row number in the Excel sheet, for the messages. */
  rowNo: number
  fullName: string
  email: string
  /** What the file said (a role name or code); the preview lets the admin pick a real one. */
  role: string
  level: string
  transport: string
  plants: string
}

export type BulkChecked = BulkRow & {
  roleName: string | null
  levelValue: string
  transportValue: string
  plantList: string[]
  errors: string[]
}

const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const text = (s: unknown) => String(s ?? '').trim()

/** The sheet as rows of cells (header: 1). Finds the header row by its Email cell, reads the columns by name, skips blank rows. */
export function parseBulkSheet(aoa: unknown[][]): BulkRow[] {
  const headerAt = aoa.findIndex((r) => (r || []).some((c) => key(c) === 'email'))
  if (headerAt < 0) return []
  const cols: Record<string, number> = {}
  ;(aoa[headerAt] || []).forEach((c, i) => {
    if (cols[key(c)] === undefined) cols[key(c)] = i
  })
  const at = (r: unknown[], name: string) => (cols[name] === undefined ? '' : text(r[cols[name]]))
  const rows: BulkRow[] = []
  for (let i = headerAt + 1; i < aoa.length; i++) {
    const r = aoa[i] || []
    const row: BulkRow = {
      rowNo: i + 1,
      fullName: at(r, 'fullname'),
      email: at(r, 'email'),
      role: at(r, 'role'),
      level: at(r, 'level'),
      transport: at(r, 'transporttype'),
      plants: at(r, 'regionplant'),
    }
    if (row.fullName || row.email || row.role || row.level || row.transport || row.plants) rows.push(row)
  }
  return rows
}

export type BulkContext = {
  /** The roles a user can be given (active ones). */
  roles: Role[]
  /** Region/Plant names that exist (the filter list). */
  plants: string[]
  /** E-mails that already have an account, lowercase. */
  existingEmails: Set<string>
}

/** Matches what was typed to a role: by its code (BC) or by its name (BEA CUKAI), in any letter case. */
export function matchRole(input: string, roles: Role[]): Role | null {
  const k = text(input).toUpperCase()
  if (!k) return null
  return roles.find((r) => r.role_name.toUpperCase() === k) || roles.find((r) => roleLabel(r) === k) || null
}

/** Checks every row; a problem is a message on that row (the row is then skipped, the others still go). */
export function checkBulkRows(rows: BulkRow[], ctx: BulkContext): BulkChecked[] {
  const seen = new Map<string, number>()
  const plantByKey = new Map(ctx.plants.map((p) => [p.toUpperCase(), p]))
  return rows.map((row) => {
    const errors: string[] = []
    const email = text(row.email).toLowerCase()
    if (!email) errors.push('Email is required.')
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email is not valid.')
    else if (ctx.existingEmails.has(email)) errors.push('This email already has an account.')
    else if (seen.has(email)) errors.push(`Same email as row ${seen.get(email)}.`)
    if (email && !seen.has(email)) seen.set(email, row.rowNo)

    const role = matchRole(row.role, ctx.roles)
    if (!role) errors.push(row.role ? `Role "${row.role}" does not exist.` : 'Choose a role.')

    const levelRaw = text(row.level)
    const levelValue = levelRaw ? BULK_LEVELS.find((l) => l.toUpperCase() === levelRaw.toUpperCase()) || '' : 'Staff'
    if (!levelValue) errors.push(`Level "${levelRaw}" is not one of: ${BULK_LEVELS.join(', ')}.`)

    const isLogistics = role?.role_name === 'LOGISTICS'
    const transportRaw = text(row.transport).toUpperCase()
    let transportValue = ''
    if (isLogistics) {
      if (transportRaw && !BULK_TRANSPORT.includes(transportRaw)) errors.push(`Transport type "${row.transport}" is not one of: ${BULK_TRANSPORT.join(', ')}.`)
      else transportValue = transportRaw
      if (!transportValue && !errors.some((e) => e.startsWith('Transport')) && TRANSPORT_LEVELS.includes(levelValue)) {
        errors.push('A LOGISTICS user needs a transport type.')
      }
    }

    // Region/Plant only applies to a role that uses it; for any other role the cell is ignored, as in the form.
    const plantList: string[] = []
    if (role?.uses_region_scope) {
      for (const part of text(row.plants).split(/[;,\n]/).map((p) => p.trim()).filter(Boolean)) {
        const found = plantByKey.get(part.toUpperCase())
        if (!found) errors.push(`Region/Plant "${part}" does not exist.`)
        else if (!plantList.includes(found)) plantList.push(found)
      }
    }
    return { ...row, email, roleName: role?.role_name ?? null, levelValue, transportValue, plantList, errors }
  })
}

/** The body of POST /users for a checked row (the same fields the Add user form sends). */
export function bulkRowBody(r: BulkChecked): Record<string, unknown> {
  const body: Record<string, unknown> = {
    full_name: r.fullName.trim(),
    email: r.email,
    role: r.roleName,
    plants: r.plantList,
    products: [],
    app: 'commdocs',
  }
  if (r.levelValue) body.level = r.levelValue
  if (r.transportValue) body.transport_type = r.transportValue
  return body
}
