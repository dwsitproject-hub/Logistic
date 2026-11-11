import path from 'path';
import * as XLSX from 'xlsx';
import logger from './logger';
import { isSapAutoImportExcelFile } from './sapAutoImportPaths';

/**
 * The SAP ME2N report (Purchasing Document, Created by, ...), read into PO -> creator pairs for the COD dashboard.
 * One row of the report is one PO item, so a PO repeats; each PO keeps its first creator, and a PO that shows two creators is counted in
 * `conflicts`. The same rules as the browser reader in the COD front end (frontend-commdocs/src/lib/poCreators.ts).
 */

export type PoCreatorRow = { po_number: string; created_by: string };

export type PoCreatorsRead = {
  rows: PoCreatorRow[];
  creators: number;
  conflicts: number;
  skipped: number;
};

const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** The sheet as rows of cells (header: 1). Null when it has no "Purchasing Document" and "Created by" columns. */
export function readPoCreators(aoa: unknown[][]): PoCreatorsRead | null {
  const headerAt = aoa.findIndex(
    (r) => (r || []).some((c) => key(c) === 'purchasingdocument') && (r || []).some((c) => key(c) === 'createdby'),
  );
  if (headerAt < 0) return null;
  const header = aoa[headerAt] || [];
  const poCol = header.findIndex((c) => key(c) === 'purchasingdocument');
  const byCol = header.findIndex((c) => key(c) === 'createdby');

  const first = new Map<string, string>();
  const seenConflict = new Set<string>();
  let conflicts = 0;
  let skipped = 0;
  for (let i = headerAt + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const po = text(r[poCol]);
    const by = text(r[byCol]);
    if (!po && !by) continue;
    if (!po || !by) {
      skipped += 1;
      continue;
    }
    const known = first.get(po);
    if (known === undefined) first.set(po, by);
    else if (known !== by && !seenConflict.has(po)) {
      seenConflict.add(po);
      conflicts += 1;
    }
  }
  const rows = [...first.entries()].map(([po_number, created_by]) => ({ po_number, created_by }));
  return { rows, creators: new Set(rows.map((r) => r.created_by)).size, conflicts, skipped };
}

/** A workbook (the bytes of the .xlsx) read through its first sheet. */
export function readPoCreatorsWorkbook(buffer: Buffer): PoCreatorsRead | null {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return null;
  return readPoCreators(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }));
}

/**
 * Which Excel files of the share's Original folder are the ME2N report: `ME2N from <date> to <date>.xlsx`. PO_CREATORS_FILE_PATTERN
 * overrides it with a regular expression (case-insensitive), for the day SAP renames the report. It never matches the daily logistics
 * export (ZMMLOG_RPT ...), which the SAP auto-import owns.
 */
export const PO_CREATORS_DEFAULT_FILE_PATTERN = '^ME2N\\s+from\\s';

export function poCreatorsFilePattern(): RegExp {
  const configured = String(process.env.PO_CREATORS_FILE_PATTERN || '').trim();
  if (configured) {
    try {
      return new RegExp(configured, 'i');
    } catch (error) {
      logger.error('PO_CREATORS_FILE_PATTERN is not a valid regular expression - using the default', {
        configured,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return new RegExp(PO_CREATORS_DEFAULT_FILE_PATTERN, 'i');
}

export function isPoCreatorsReportFile(fileName: string): boolean {
  if (!isSapAutoImportExcelFile(fileName)) return false;
  return poCreatorsFilePattern().test(path.basename(fileName));
}

/** The newest of several files, by modification time; the name breaks a tie so the choice is the same every run. */
export function pickNewestReport<T extends { fileName: string; mtimeMs: number }>(files: readonly T[]): T | null {
  if (!files.length) return null;
  return [...files].sort((a, b) => b.mtimeMs - a.mtimeMs || b.fileName.localeCompare(a.fileName, undefined, { numeric: true }))[0];
}
