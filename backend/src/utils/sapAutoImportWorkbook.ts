import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import {
  identityToFailedCells,
  identityToSuccessCells,
  SAP_AUTO_IMPORT_FAILED_HEADERS,
  SAP_AUTO_IMPORT_SUCCESS_HEADERS,
  type SapAutoImportIdentityRow,
} from './sapAutoImportIdentity';

function writeIdentityWorkbook(
  filePath: string,
  headers: readonly string[],
  rows: SapAutoImportIdentityRow[],
  toCells: (row: SapAutoImportIdentityRow) => string[],
): void {
  const aoa: string[][] = [headers.slice() as string[], ...rows.map(toCells)];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'SAP');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  XLSX.writeFile(book, filePath);
}

/** Writes Success workbook. Returns false if rows is empty (no file created). */
export function writeSapAutoImportSuccessWorkbook(
  filePath: string,
  rows: SapAutoImportIdentityRow[],
): boolean {
  if (rows.length === 0) return false;
  writeIdentityWorkbook(filePath, SAP_AUTO_IMPORT_SUCCESS_HEADERS, rows, identityToSuccessCells);
  return true;
}

/** Writes Failed workbook with Remarks. Returns false if rows is empty (no file created). */
export function writeSapAutoImportFailedWorkbook(
  filePath: string,
  rows: SapAutoImportIdentityRow[],
): boolean {
  if (rows.length === 0) return false;
  writeIdentityWorkbook(filePath, SAP_AUTO_IMPORT_FAILED_HEADERS, rows, identityToFailedCells);
  return true;
}
