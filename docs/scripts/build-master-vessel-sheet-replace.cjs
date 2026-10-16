/**
 * Builds docs/scripts/replace-master-vessel-from-sheet.cjs from the vessel master sheet, with the sheet's vessels and pairs embedded, so
 * the replacement can run on a server as one file (git show ... | docker exec -i klip-backend node -).
 *
 *   cd backend && node ../docs/scripts/build-master-vessel-sheet-replace.cjs "<path to Master Data - CPO ....xlsx>"
 *
 * Reads the sheet whose name starts with "Vessel - Klip" (Excel cuts "Vessel - Klip (Final Validation)" to 31 characters), ALL rows.
 * Run from backend/ so `xlsx` resolves.
 *
 * Layout (Ryan, 2026-10-16): one row per SAP identity of a vessel.
 *   A Pair ID             only on a combo pair (SAP name "TB. x / BG. y"): two rows, the tug's and the barge's, same C and E
 *   B Vessel Name (DHM)   the vessel; a vessel SAP also names alone has its own row without Pair ID
 *   C Vessel Name (SAP)   what users see; D Transaksi Klip (info); E Vessel Code (SAP), comma list
 *   F Company Code, G Owner, H Capacity, I Vessel Type, J Heating, K Type Lambung, L Charter Type, M Draft, N LOA, O Hull Type, P Year
 *
 * Every vessel (column B) becomes one row in the format services/masterVesselSheetReplace.service.ts parseSheetVessel reads (the
 * earlier layout's letters: B name, E company, F owner, G capacity, H type, I heating, J lambung, K charter, L draft, M LOA, N hull,
 * O year, P codes): attributes from its own row, else from a pair row. A combo pair's SAP codes go to the BARGE (KLIP sees a combo
 * shipment as its barge, Ryan 2026-10-16); the tug is linked through the pair. In the sheet a combo tug row carries the barge's
 * capacity and type, so a tug with no row of its own is loaded as TUG BOAT without capacity.
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
const cell = (c, r) => {
  const v = ws[c + r];
  if (v == null) return null;
  const s = String(v.w != null ? v.w : v.v).replace(/\s+/g, ' ').trim();
  return s || null;
};
const expected = { A: 'PAIR ID', B: 'VESSEL NAME (DHM)', C: 'VESSEL NAME (SAP)', E: 'VESSEL CODE (SAP)', H: 'VESSEL CAPACITY', I: 'VESSEL TYPE', P: 'VESSEL REGISTRATION YEAR' };
for (const [c, h] of Object.entries(expected)) {
  if (String(cell(c, 1) || '').toUpperCase() !== h) {
    console.error(`column ${c} is "${cell(c, 1)}", expected "${h}": the sheet layout changed, update this builder`);
    process.exit(1);
  }
}

const sheetRows = [];
for (let r = 2; r <= range.e.r + 1; r++) {
  const name = cell('B', r);
  if (!name || name.toUpperCase() === expected.B) continue;
  const row = { r };
  for (const c of 'ABCDEFGHIJKLMNOP') row[c] = cell(c, r);
  row.B = name.toUpperCase();
  sheetRows.push(row);
}
const roleOf = (row) => {
  if (/^TB\b/.test(row.B)) return 'TB';
  if (/^(BG|TK)\b/.test(row.B)) return 'BG';
  return /^TUG/i.test(row.I || '') ? 'TB' : 'OTHER';
};
const codesOf = (v) => String(v || '').split(/[,;]/).map((c) => c.trim().toUpperCase()).filter(Boolean);

// pairs: rows sharing a Pair ID, exactly one tug and one barge
const pairGroups = new Map();
for (const row of sheetRows) if (row.A) pairGroups.set(row.A, [...(pairGroups.get(row.A) || []), row]);
const pairs = [];
const pairProblems = [];
for (const [pairCode, members] of pairGroups) {
  const tb = members.filter((m) => roleOf(m) === 'TB');
  const bg = members.filter((m) => roleOf(m) !== 'TB');
  if (tb.length === 1 && bg.length === 1) pairs.push({ pairCode, tb: tb[0].B, bg: bg[0].B, sapName: bg[0].C || tb[0].C });
  else pairProblems.push(`${pairCode}: ${members.map((m) => m.B).join(' + ')}`);
}

// one loader row per vessel
const byName = new Map();
for (const row of sheetRows) byName.set(row.B, [...(byName.get(row.B) || []), row]);
const rows = [];
const ownRowTwice = [];
for (const [name, list] of byName) {
  const own = list.filter((x) => !x.A);
  if (own.length > 1) ownRowTwice.push(`${name} (rows ${own.map((x) => x.r).join(', ')})`);
  const inPairs = list.filter((x) => x.A);
  const role = roleOf(list[0]);
  const base = own[0] || inPairs[0];
  const codes = [];
  const addCodes = (v) => { for (const c of codesOf(v)) if (!codes.includes(c)) codes.push(c); };
  for (const o of own) addCodes(o.E);
  if (role !== 'TB') for (const p of inPairs) addCodes(p.E);
  const tugOnlyInPairs = role === 'TB' && own.length === 0;
  rows.push({
    row: base.r,
    A: null,
    B: name,
    E: base.F,
    F: base.G,
    G: tugOnlyInPairs ? null : base.H,
    H: tugOnlyInPairs ? 'TUG BOAT' : base.I,
    I: base.J,
    J: base.K,
    K: base.L,
    L: base.M,
    M: base.N,
    N: base.O,
    O: base.P,
    P: codes.join(', ') || null,
  });
}
rows.sort((a, b) => a.row - b.row);

const summary = `${sheetRows.length} sheet rows -> ${rows.length} vessels, ${pairs.length} pairs`;
const template = fs.readFileSync(path.join(__dirname, 'replace-master-vessel-from-sheet.template.cjs'), 'utf8');
const out = template
  .replace('__SOURCE__', JSON.stringify(`${path.basename(file)} / ${sheetName} (${summary})`))
  .replace('__ROWS__', JSON.stringify(rows))
  .replace('__PAIRS__', JSON.stringify(pairs));
fs.writeFileSync(path.join(__dirname, 'replace-master-vessel-from-sheet.cjs'), out);
console.log(`wrote replace-master-vessel-from-sheet.cjs: ${summary} from "${sheetName}"`);
if (pairProblems.length) console.log(`pairs NOT loaded (need exactly one TB and one BG): ${pairProblems.join('; ')}`);
if (ownRowTwice.length) console.log(`vessels with more than one row without Pair ID (first row's attributes used): ${ownRowTwice.join('; ')}`);
