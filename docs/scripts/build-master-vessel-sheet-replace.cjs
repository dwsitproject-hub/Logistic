/**
 * Builds docs/scripts/replace-master-vessel-from-sheet.cjs from the vessel master sheet, with the sheet's rows embedded, so the replacement
 * can run on a server as one file (git show ... | docker exec -i klip-backend node -).
 *
 *   cd backend && node ../docs/scripts/build-master-vessel-sheet-replace.cjs "<path to Master Data - CPO ....xlsx>"
 *
 * Reads the sheet whose name starts with "Vessel - Klip" (Excel cuts "Vessel - Klip (Final Validation)" to 31 characters), columns A-P,
 * ALL rows (the sheet's filter on column D is a view only), column C ignored (Ryan, 2026-10-15). Run from backend/ so `xlsx` resolves.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(process.cwd(), 'node_modules', 'xlsx'));

const file = process.argv[2];
if (!file) {
  console.error('usage: node ../docs/scripts/build-master-vessel-sheet-replace.cjs "<workbook.xlsx>"');
  process.exit(1);
}
const wb = XLSX.readFile(file);
const sheetName = wb.SheetNames.find((n) => n.startsWith('Vessel - Klip'));
if (!sheetName) {
  console.error(`no sheet starting with "Vessel - Klip" in ${file}; sheets: ${wb.SheetNames.join(' | ')}`);
  process.exit(1);
}
const ws = wb.Sheets[sheetName];
const range = XLSX.utils.decode_range(ws['!ref']);
const cols = 'ABDEFGHIJKLMNOP'.split('');
const cell = (c, r) => {
  const v = ws[c + r];
  if (v == null) return null;
  const s = String(v.w != null ? v.w : v.v).trim();
  return s || null;
};
const header = cols.map((c) => `${c}=${cell(c, 1)}`).join(', ');
const rows = [];
for (let r = 2; r <= range.e.r + 1; r++) {
  const row = { row: r };
  let any = false;
  for (const c of cols) {
    row[c] = cell(c, r);
    if (row[c] != null) any = true;
  }
  if (any) rows.push(row);
}

const template = fs.readFileSync(path.join(__dirname, 'replace-master-vessel-from-sheet.template.cjs'), 'utf8');
const out = template
  .replace('__SOURCE__', JSON.stringify(`${path.basename(file)} / ${sheetName} (${rows.length} rows; ${header})`))
  .replace('__ROWS__', JSON.stringify(rows));
fs.writeFileSync(path.join(__dirname, 'replace-master-vessel-from-sheet.cjs'), out);
console.log(`wrote replace-master-vessel-from-sheet.cjs: ${rows.length} rows from "${sheetName}"`);
