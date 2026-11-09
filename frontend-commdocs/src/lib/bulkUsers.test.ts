import { describe, expect, it } from 'vitest'
import { BULK_HEADERS, bulkRowBody, checkBulkRows, matchRole, parseBulkSheet } from './bulkUsers'
import { buildBulkUsersTemplate } from './bulkUsersTemplate'
import type { Role } from './types'

const role = (role_name: string, display_name: string, uses_region_scope = false): Role => ({ id: role_name, role_name, display_name, description: null, is_active: true, uses_region_scope })
const ROLES = [role('ADMIN', 'Admin'), role('BC', 'Bea Cukai'), role('LOGISTICS', 'Logistics', true), role('AR_UPSTREAM', 'AR Upstream', true)]
const ctx = { roles: ROLES, plants: ['BATAM', 'DUMAI'], existingEmails: new Set(['old@x.co']) }
const sheet = [[...BULK_HEADERS]]
const row = (...c: string[]) => [...c]

describe('parseBulkSheet', () => {
  it('reads columns by header name, skips blank rows, keeps the Excel row number', () => {
    const rows = parseBulkSheet([['Full name', 'EMAIL', 'role'], ['Ana', 'ana@x.co', 'BC'], ['', '', ''], ['Budi', 'budi@x.co', 'Logistics']])
    expect(rows.map((r) => [r.rowNo, r.fullName, r.email, r.role])).toEqual([[2, 'Ana', 'ana@x.co', 'BC'], [4, 'Budi', 'budi@x.co', 'Logistics']])
  })
  it('finds nothing without an Email column', () => expect(parseBulkSheet([['Name', 'Role'], ['a', 'b']])).toEqual([]))
})

describe('checkBulkRows', () => {
  const check = (...rows: string[][]) => checkBulkRows(parseBulkSheet([sheet[0], ...rows]), ctx)
  it('accepts a role by code or by name, any letter case, and defaults the level to Staff', () => {
    const [a, b] = check(row('Ana', 'ana@x.co', 'bc'), row('Budi', 'budi@x.co', 'BEA CUKAI'))
    expect(a.errors).toEqual([])
    expect([a.roleName, a.levelValue, b.roleName]).toEqual(['BC', 'Staff', 'BC'])
  })
  it('flags bad rows with a message each', () => {
    const r = check(row('A', '', 'BC'), row('B', 'b@x', 'BC'), row('C', 'old@x.co', 'BC'), row('D', 'd@x.co', 'NOPE'), row('E', 'd@x.co', 'BC'), row('F', 'f@x.co', 'BC', 'Boss'))
    expect(r.map((x) => x.errors[0])).toEqual(['Email is required.', 'Email is not valid.', 'This email already has an account.', 'Role "NOPE" does not exist.', 'Same email as row 5.', 'Level "Boss" is not one of: Staff, Section Head, Dept Head, Admin.'])
  })
  it('asks LOGISTICS (Staff/Section Head/Admin) for a transport type, and only LOGISTICS', () => {
    const [a, b, c, d] = check(row('A', 'a@x.co', 'LOGISTICS', 'Staff'), row('B', 'b@x.co', 'LOGISTICS', 'Staff', 'sea'), row('C', 'c@x.co', 'LOGISTICS', 'Dept Head'), row('D', 'd@x.co', 'BC', 'Staff', 'SEA'))
    expect(a.errors).toEqual(['A LOGISTICS user needs a transport type.'])
    expect([b.errors, b.transportValue]).toEqual([[], 'SEA'])
    expect(c.errors).toEqual([])
    expect([d.errors, d.transportValue]).toEqual([[], ''])
  })
  it('reads Region/Plant only for roles that use it, several separated by ";"', () => {
    const [a, b, c] = check(row('A', 'a@x.co', 'AR_UPSTREAM', '', '', 'batam; Dumai'), row('B', 'b@x.co', 'BC', '', '', 'BATAM'), row('C', 'c@x.co', 'AR_UPSTREAM', '', '', 'MARS'))
    expect(a.plantList).toEqual(['BATAM', 'DUMAI'])
    expect(b.plantList).toEqual([])
    expect(c.errors).toEqual(['Region/Plant "MARS" does not exist.'])
  })
  it('builds the same body as the Add user form', () => {
    const [a] = check(row('Ana', 'Ana@X.co', 'AR_UPSTREAM', 'Section Head', '', 'BATAM'))
    expect(bulkRowBody(a)).toEqual({ full_name: 'Ana', email: 'ana@x.co', role: 'AR_UPSTREAM', plants: ['BATAM'], products: [], app: 'commdocs', level: 'Section Head' })
  })
  it('matchRole needs a real role', () => expect(matchRole('', ROLES)).toBeNull())
})

describe('the Excel template', () => {
  it('has real dropdowns for Role, Level and Transport type, fed from the roles that exist', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await buildBulkUsersTemplate(ROLES, ['BATAM', 'DUMAI']))
    const ws = wb.getWorksheet('Users')!
    expect(ws.getRow(1).values).toEqual([undefined, ...BULK_HEADERS])
    expect(ws.getCell('C2').dataValidation).toMatchObject({ type: 'list', formulae: ['Lists!$A$2:$A$5'] })
    expect(ws.getCell('C200').dataValidation?.type).toBe('list')
    expect(ws.getCell('D2').dataValidation).toMatchObject({ type: 'list', formulae: ['Lists!$B$2:$B$5'] })
    const lists = wb.getWorksheet('Lists')!
    expect([2, 3, 4, 5].map((r) => lists.getCell(r, 1).value)).toEqual(['ADMIN', 'BEA CUKAI', 'LOGISTICS', 'AR UPSTREAM'])
  })
})
