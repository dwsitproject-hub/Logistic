/**
 * The ZUSER extract of SAP's user master (columns Client, User, First Name, Last Name) read into users, for the SAP Users menu.
 * The headers and values carry trailing spaces (SAP pads them), so both are trimmed. A user listed twice keeps its first row.
 */

export type SapUserRow = { user_id: string; client: string; first_name: string; last_name: string }

export type SapUsersRead = {
  rows: SapUserRow[]
  /** Users that appear on more than one row (the first is kept). */
  duplicates: number
  /** Data rows without a user. */
  skipped: number
}

const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

/** The sheet as rows of cells (header: 1). Null when it has no "User", "First Name" and "Last Name" columns. */
export function readSapUsers(aoa: unknown[][]): SapUsersRead | null {
  const headerAt = aoa.findIndex((r) => {
    const keys = (r || []).map(key)
    return keys.includes('user') && keys.includes('firstname') && keys.includes('lastname')
  })
  if (headerAt < 0) return null
  const keys = (aoa[headerAt] || []).map(key)
  const col = { user: keys.indexOf('user'), first: keys.indexOf('firstname'), last: keys.indexOf('lastname'), client: keys.indexOf('client') }

  const seen = new Set<string>()
  const rows: SapUserRow[] = []
  let duplicates = 0
  let skipped = 0
  for (let i = headerAt + 1; i < aoa.length; i++) {
    const r = aoa[i] || []
    const user_id = text(r[col.user])
    if (!user_id) {
      if (r.some((c) => text(c))) skipped += 1
      continue
    }
    if (seen.has(user_id)) {
      duplicates += 1
      continue
    }
    seen.add(user_id)
    rows.push({ user_id, client: col.client >= 0 ? text(r[col.client]) : '', first_name: text(r[col.first]), last_name: text(r[col.last]) })
  }
  return { rows, duplicates, skipped }
}
