/**
 * Build sheet Jovin_SAP_Mapping: Jovin rows (all columns) + SAP-only extra vessels.
 *
 * Usage: npx ts-node src/scripts/fillJovinVesselCodesFromSap.ts [--file "D:/path.xlsx"]
 */
import path from 'path';
import * as XLSX from 'xlsx';
import {
  buildJovinSapMappingRows,
  type VesselCodeSourceRow,
} from '../utils/jovinVesselCodeMatch';

const DEFAULT_FILE = path.resolve(__dirname, '../../../docs/Vessel Cleanup (Jovin, Klip, SAP).xlsx');
const MAPPING_SHEET = 'Jovin_SAP_Mapping';

const JOVIN_BASE_HEADERS = [
  'Vessel Name',
  'Company Code',
  'Company Name',
  'Delivery Term',
  'Vessel Code',
  'Vessel Capacity',
  'Vessel Type',
  'Heating',
  'Type Lambung',
  'Terms',
  'Remark',
];

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function sheetObjects(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: false }) as Record<string, unknown>[];
}

function sourceRows(rows: Record<string, unknown>[], nameKey: string, codeKey: string): VesselCodeSourceRow[] {
  return rows.map((r) => ({
    name: String(r[nameKey] ?? ''),
    code: String(r[codeKey] ?? ''),
  }));
}

function headerIndex(row: unknown[], label: string): number {
  const want = label.trim().toUpperCase();
  return row.findIndex((c) => String(c ?? '').trim().toUpperCase() === want);
}

function setCell(ws: XLSX.WorkSheet, r: number, c: number, value: string) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!value) {
    if (ws[addr]) delete ws[addr];
    return;
  }
  ws[addr] = { t: 's', v: value };
}

function clearJovinFilledColumns(wb: XLSX.WorkBook) {
  const ws = wb.Sheets.Jovin;
  if (!ws) return;
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false }) as unknown[][];
  const header = (matrix[0] || []).map((c) => String(c ?? ''));
  const codeCol = headerIndex(header, 'Vessel Code');
  const helperLabels = ['Matched Name', 'Match Source', 'Match Quality', 'Match Notes'];
  const helperCols = helperLabels
    .map((label) => headerIndex(header, label))
    .filter((i) => i >= 0);
  for (let r = 1; r < matrix.length; r += 1) {
    if (codeCol >= 0) setCell(ws, r, codeCol, '');
    for (const c of helperCols) setCell(ws, r, c, '');
  }
  for (const c of helperCols) setCell(ws, 0, c, '');
}

function main() {
  const filePath = path.resolve(argValue('--file') || DEFAULT_FILE);
  const wb = XLSX.readFile(filePath, { cellDates: true });
  if (!wb.SheetNames.includes('Jovin') || !wb.SheetNames.includes('SAP')) {
    throw new Error(`Expected sheets Jovin and SAP. Found: ${wb.SheetNames.join(', ')}`);
  }

  const jovinRows = sheetObjects(wb.Sheets.Jovin);
  const sapRows = sourceRows(sheetObjects(wb.Sheets.SAP), 'Vessel Name', 'Vessel Code');
  const klipRows = wb.SheetNames.includes('KLIP')
    ? sourceRows(sheetObjects(wb.Sheets.KLIP), 'Vessel Name', 'Vessel Code')
    : [];

  const mapping = buildJovinSapMappingRows(jovinRows, sapRows, klipRows);

  const headers = [
    'Source',
    ...JOVIN_BASE_HEADERS,
    'Matched Name',
    'Match Source',
    'Match Quality',
    'Match Notes',
  ];

  const aoa: unknown[][] = [headers];
  const counts = { jovinSap: 0, jovinOnly: 0, sapOnly: 0, exact: 0, aliasGroup: 0, fuzzy: 0, unmatched: 0 };
  const samples: string[] = [];

  for (const row of mapping) {
    if (row.source === 'Jovin, SAP') counts.jovinSap += 1;
    else if (row.source === 'Jovin') counts.jovinOnly += 1;
    else counts.sapOnly += 1;
    if (row.matchQuality === 'exact') counts.exact += 1;
    else if (row.matchQuality === 'alias-group') counts.aliasGroup += 1;
    else if (row.matchQuality === 'fuzzy') counts.fuzzy += 1;
    else counts.unmatched += 1;

    const line = headers.map((h) => {
      if (h === 'Source') return row.source;
      if (h === 'Vessel Name') return row.vesselName;
      if (h === 'Vessel Code') return row.vesselCode;
      if (h === 'Matched Name') return row.matchedName;
      if (h === 'Match Source') return row.matchSource;
      if (h === 'Match Quality') return row.matchQuality;
      if (h === 'Match Notes') return row.matchNotes;
      const v = row.jovinFields[h];
      return v == null || v === '' ? null : v;
    });
    aoa.push(line);

    const n = row.vesselName.toUpperCase();
    if (n.includes('ADAMAS 405') || n.includes('LUMINOR 10') || n.includes('MARINA 9') || n.includes('MARINA 12')) {
      samples.push(`${row.source} | ${row.vesselName} => ${row.vesselCode || '(blank)'} [${row.matchQuality}]`);
    }
  }

  const mappingWs = XLSX.utils.aoa_to_sheet(aoa);
  if (wb.Sheets[MAPPING_SHEET]) {
    wb.SheetNames = wb.SheetNames.filter((n) => n !== MAPPING_SHEET);
    delete wb.Sheets[MAPPING_SHEET];
  }
  XLSX.utils.book_append_sheet(wb, mappingWs, MAPPING_SHEET);
  clearJovinFilledColumns(wb);
  XLSX.writeFile(wb, filePath);

  console.log(`Wrote ${filePath} sheet ${MAPPING_SHEET}`);
  console.log(JSON.stringify({ ...counts, samples }, null, 2));
}

main();
