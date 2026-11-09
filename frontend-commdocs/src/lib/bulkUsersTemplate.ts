import { BULK_HEADERS, BULK_LEVELS, BULK_TRANSPORT, MAX_BULK_ROWS } from './bulkUsers'
import { saveBlob } from './files'
import { roleLabel } from './roles'
import type { Role } from './types'

/**
 * The Excel template for Users > Bulk upload. Role, Level and Transport type are real Excel dropdowns (data validation fed from a Lists sheet
 * that is built from the roles that exist right now), so a role added in the app shows up in the next template. Region/Plant is a dropdown that
 * still accepts several names typed with ";" between them. ExcelJS is loaded only when the template is downloaded.
 */
export async function buildBulkUsersTemplate(roles: Role[], plants: string[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Users', { views: [{ state: 'frozen', ySplit: 1 }] })
  const lists = wb.addWorksheet('Lists')
  const help = wb.addWorksheet('How to fill')

  // Lists: one column per dropdown.
  const roleNames = roles.map((r) => roleLabel(r))
  const columns: Array<[string, string[]]> = [
    ['Role', roleNames],
    ['Level', BULK_LEVELS],
    ['Transport type', BULK_TRANSPORT],
    ['Region/Plant', plants],
  ]
  columns.forEach(([title, values], c) => {
    lists.getCell(1, c + 1).value = title
    lists.getCell(1, c + 1).font = { bold: true }
    values.forEach((v, i) => (lists.getCell(i + 2, c + 1).value = v))
    lists.getColumn(c + 1).width = 24
  })
  const range = (col: string, n: number) => `Lists!$${col}$2:$${col}$${Math.max(n, 1) + 1}`

  // Users: header + dropdowns for MAX_BULK_ROWS rows.
  ws.addRow([...BULK_HEADERS])
  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6B73' } }
  header.alignment = { vertical: 'middle' }
  header.height = 22
  ;[26, 32, 22, 16, 18, 26].forEach((w, i) => (ws.getColumn(i + 1).width = w))
  const dropdown = (col: number, formula: string, strict: boolean, title: string, message: string) => {
    for (let r = 2; r <= MAX_BULK_ROWS + 1; r++) {
      ws.getCell(r, col).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: strict,
        errorStyle: 'stop',
        errorTitle: title,
        error: message,
        showInputMessage: true,
        promptTitle: title,
        prompt: message,
      }
    }
  }
  dropdown(3, range('A', roleNames.length), true, 'Role', 'Pick a role from the list.')
  dropdown(4, range('B', BULK_LEVELS.length), true, 'Level', 'Pick a level. Empty means Staff.')
  dropdown(5, range('C', BULK_TRANSPORT.length), true, 'Transport type', 'Only for LOGISTICS: SEA, LAND, ALL or MIX.')
  dropdown(6, range('D', plants.length), false, 'Region/Plant', 'Pick one, or type several separated by ";". Only used by roles with a default Region/Plant.')

  // How to fill.
  const notes = [
    'Users bulk upload',
    '',
    `1. Fill the sheet "Users", one person per row (up to ${MAX_BULK_ROWS} rows). Do not rename or move the header row.`,
    '2. Email is required. Everyone gets an e-mail to choose their own password.',
    '3. Role: pick from the dropdown. The list is the roles that exist when you download this template.',
    '4. Level: pick from the dropdown. Empty means Staff.',
    '5. Transport type: only for LOGISTICS (Section Head, Staff and Admin levels need one).',
    '6. Region/Plant: only for roles that use a default Region/Plant. Several names: separate them with ";".',
    '7. Save the file as .xlsx, then upload it in Users > Bulk upload. You see every row checked before anything is created.',
  ]
  notes.forEach((n, i) => (help.getCell(i + 1, 1).value = n))
  help.getCell(1, 1).font = { bold: true, size: 14 }
  help.getColumn(1).width = 120

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

export async function downloadBulkUsersTemplate(roles: Role[], plants: string[]): Promise<void> {
  const buffer = await buildBulkUsersTemplate(roles, plants)
  saveBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'COD-Users-Template.xlsx')
}
