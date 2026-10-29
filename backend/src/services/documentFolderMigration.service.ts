/**
 * Files documents where they belong, on the upload root (the Synology share in production):
 *
 *   shipment Contract / SI / BL        ->  documents/shipment/<contract|si|bl>/<STO number, else operation id>/
 *   documents of a trucking operation  ->  documents/trucking/<PO number, else operation id, else contract number>/
 *
 * The names are those of utils/documentFolders.ts. Two things put a document somewhere else: every client appends `file` before `document_type` / `shipment_id`, so multer's
 * destination callback saw an empty body and wrote to the upload root (found 2026-10-29), and the first version of this migration named the folders after the database id
 * (a uuid) and the operation id, which Ryan asked to be the STO and the PO. Running it again therefore also moves what an earlier run filed under the old names, and
 * a shipment that has since been given an STO is moved from its operation-id folder to its STO folder.
 *
 * Only the FOLDER changes. The file keeps its name, `documents.file_name` is untouched, and `documents.file_path` is rewritten to the new place, so a download by id
 * (which is what the JPS links use) keeps working. A row whose file cannot be found, whose target name is taken (on disk, or by another row of the same run), or that
 * has nothing to file it under is reported and left alone. A folder emptied by a move is removed when it is a subject folder (never the upload root, never documents/shipment/<kind>).
 *
 * planDocumentMoves is pure (it asks the caller whether a file exists); applyDocumentMoves does the moves, one row at a time, undoing the move when the database
 * update does not take. The runner is docs/scripts/migrate-documents-to-folders.cjs.
 */
import fs from 'fs';
import path from 'path';
import { SHIPMENT_FOLDER_SUBJECT_SQL, TRUCKING_OPERATION_FOLDER_SUBJECT_SQL } from '../utils/documentFolders';
import {
  buildShipmentDocumentUploadSubdir,
  buildTruckingDocumentUploadSubdir,
  getUploadRootDir,
  resolveUploadAbsolutePath,
  shipmentStructuredDocKindFromType,
  toRelativeUploadPath,
} from '../utils/fileUpload';

export interface DocumentRow {
  id: string;
  document_type: string | null;
  file_name: string | null;
  file_path: string;
  shipment_id: string | null;
  trucking_operation_id: string | null;
  /** The STO number (else operation id) of shipment_id, from the key the Shipments page groups by; null when the shipment row is gone. */
  shipment_folder: string | null;
  /** The PO number (else operation id, else contract number) of trucking_operation_id's contract. */
  trucking_folder: string | null;
}

export type MoveAction = 'move' | 'already_in_place' | 'missing' | 'collision' | 'no_target';

export interface MovePlan {
  id: string;
  kind: 'shipment' | 'trucking';
  documentType: string | null;
  fileName: string | null;
  fromStored: string;
  toStored: string | null;
  fromAbs: string;
  toAbs: string | null;
  action: MoveAction;
}

/** The rows this migration looks at: shipment Contract / SI / BL, and anything filed on a trucking operation. */
export const SELECT_DOCUMENTS_TO_FILE_SQL = `
  SELECT d.id::text AS id, d.document_type, d.file_name, d.file_path,
         d.shipment_id::text AS shipment_id, d.trucking_operation_id::text AS trucking_operation_id,
         CASE WHEN s.id IS NOT NULL THEN ${SHIPMENT_FOLDER_SUBJECT_SQL} END AS shipment_folder,
         CASE WHEN t.id IS NOT NULL THEN ${TRUCKING_OPERATION_FOLDER_SUBJECT_SQL} END AS trucking_folder
    FROM documents d
    LEFT JOIN shipments s ON s.id = d.shipment_id
    LEFT JOIN contracts c ON c.id = s.contract_id
    LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
    LEFT JOIN trucking_operations t ON t.id = d.trucking_operation_id
    LEFT JOIN contracts ct ON ct.id = t.contract_id
   WHERE (UPPER(COALESCE(d.document_type, '')) IN ('CONTRACT', 'SI', 'BL') AND d.shipment_id IS NOT NULL)
      OR d.trucking_operation_id IS NOT NULL
   ORDER BY d.upload_date NULLS LAST, d.id`;

/** The folder a row belongs in, relative to the upload root; null when there is no way to tell. SLD / SDD stay where they are (nothing writes to them any more). */
export function targetSubdirFor(row: DocumentRow): { kind: 'shipment' | 'trucking'; subdir: string } | null {
  const kind = shipmentStructuredDocKindFromType(String(row.document_type ?? ''));
  if (row.shipment_id && (kind === 'contract' || kind === 'si' || kind === 'bl')) {
    // The shipment row is gone (deleted): its id is the only name left.
    const subject = String(row.shipment_folder ?? '').trim() || row.shipment_id;
    return { kind: 'shipment', subdir: buildShipmentDocumentUploadSubdir(subject, kind) };
  }
  if (row.trucking_operation_id) {
    const subject = String(row.trucking_folder ?? '').trim();
    if (!subject) return null;
    return { kind: 'trucking', subdir: buildTruckingDocumentUploadSubdir(subject) };
  }
  return null;
}

export function planDocumentMoves(rows: DocumentRow[], exists: (absPath: string) => boolean = fs.existsSync): MovePlan[] {
  const root = getUploadRootDir();
  const claimed = new Set<string>(); // targets already given to a row of this run
  return rows.map((row) => {
    const fromAbs = resolveUploadAbsolutePath(row.file_path);
    const target = targetSubdirFor(row);
    const base: Omit<MovePlan, 'action' | 'toStored' | 'toAbs'> = {
      id: row.id,
      kind: target?.kind ?? (row.trucking_operation_id ? 'trucking' : 'shipment'),
      documentType: row.document_type,
      fileName: row.file_name,
      fromStored: row.file_path,
      fromAbs,
    };
    if (!target) return { ...base, toStored: null, toAbs: null, action: 'no_target' };
    const toAbs = path.join(root, target.subdir, path.basename(fromAbs));
    const toStored = toRelativeUploadPath(toAbs);
    if (path.resolve(path.dirname(fromAbs)) === path.resolve(path.dirname(toAbs))) return { ...base, toStored: row.file_path, toAbs: fromAbs, action: 'already_in_place' };
    if (!exists(fromAbs)) return { ...base, toStored, toAbs, action: 'missing' };
    const key = path.resolve(toAbs);
    // Two rows of different folders can carry the same file name and meet in one STO / PO folder: the first gets it, the second is left for a person to look at.
    if (exists(toAbs) || claimed.has(key)) return { ...base, toStored, toAbs, action: 'collision' };
    claimed.add(key);
    return { ...base, toStored, toAbs, action: 'move' };
  });
}

export interface MoveDb {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount?: number | null }>;
}

export interface MoveResult {
  moved: Array<{ id: string; from: string; to: string }>;
  failed: Array<{ id: string; reason: string }>;
}

function moveFile(from: string, to: string): void {
  // rename() replaces an existing file without a word; a target that appeared since the plan was made is refused instead.
  if (fs.existsSync(to)) throw new Error('target already exists');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as { code?: string })?.code !== 'EXDEV') throw err;
    // Another file system: copy, check the size, then remove the original.
    fs.copyFileSync(from, to);
    if (fs.statSync(to).size !== fs.statSync(from).size) {
      fs.unlinkSync(to);
      throw new Error('copy size mismatch');
    }
    fs.unlinkSync(from);
  }
}

/**
 * Removes the folder a file was moved out of, when it is a SUBJECT folder (documents/shipment/<kind>/<subject> or documents/trucking/<subject>) and now empty.
 * Never the upload root, never documents, documents/shipment, a <kind> folder or documents/trucking: those are the share's structure. rmdir refuses a folder that holds anything.
 */
export function removeIfEmptySubjectFolder(dir: string): boolean {
  const documentsRoot = path.resolve(getUploadRootDir(), 'documents');
  const rel = path.relative(documentsRoot, path.resolve(dir));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  const isSubject = (parts[0] === 'shipment' && parts.length === 3) || (parts[0] === 'trucking' && parts.length === 2);
  if (!isSubject) return false;
  try {
    fs.rmdirSync(path.resolve(dir));
    return true;
  } catch {
    return false;
  }
}

/**
 * Does the moves of a plan (only the rows that say 'move'). For each: move the file, then point documents.file_path at it with a guard on the old value; when that
 * update touches nothing (the row changed meanwhile) or fails, the file goes back. A failure on one row never stops the rest.
 */
export async function applyDocumentMoves(plans: MovePlan[], db: MoveDb, options: { limit?: number } = {}): Promise<MoveResult> {
  const result: MoveResult = { moved: [], failed: [] };
  const todo = plans.filter((p) => p.action === 'move' && p.toAbs && p.toStored);
  for (const plan of options.limit && options.limit > 0 ? todo.slice(0, options.limit) : todo) {
    const toAbs = plan.toAbs as string;
    const toStored = plan.toStored as string;
    try {
      moveFile(plan.fromAbs, toAbs);
    } catch (err) {
      result.failed.push({ id: plan.id, reason: `move: ${(err as Error).message}` });
      continue;
    }
    try {
      const upd = await db.query('UPDATE documents SET file_path = $2 WHERE id = $1 AND file_path = $3', [plan.id, toStored, plan.fromStored]);
      if (!upd.rowCount) throw new Error('row changed or gone');
      result.moved.push({ id: plan.id, from: plan.fromStored, to: toStored });
      removeIfEmptySubjectFolder(path.dirname(plan.fromAbs));
    } catch (err) {
      try {
        moveFile(toAbs, plan.fromAbs);
      } catch {
        result.failed.push({ id: plan.id, reason: `update failed AND the file could not be put back (it is at ${toAbs})` });
        continue;
      }
      result.failed.push({ id: plan.id, reason: `update: ${(err as Error).message}; file put back` });
    }
  }
  return result;
}

/** The SQL that puts every moved row's file_path back (the files go back by hand or by the same runner with the pairs swapped). */
export function rollbackSqlForMoves(moved: MoveResult['moved']): string[] {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return moved.map((m) => `UPDATE documents SET file_path = ${q(m.from)} WHERE id = ${q(m.id)} AND file_path = ${q(m.to)};`);
}
