/**
 * Renames the Commercial Documents folder on the upload root (the Synology share in production) from `COMMERCIAL DOCS` to `commercial-docs`, and brings the stored paths in step.
 *
 * Why not just rename the folder on the share: commercial_document_files.file_path (and commercial_document_history.file_path) hold `uploads/COMMERCIAL DOCS/<year>/<month>/<PO>/<file>`,
 * and every view and download resolves it. A folder renamed behind the database's back leaves every existing document unreadable, and the code builds the folder name
 * for new uploads, so it would be created again under the old name.
 *
 * The order that keeps documents readable at every moment, with resolveUploadAbsolutePath finding a file under either spelling while the two are out of step:
 *   1. the code that builds the new name is deployed (new uploads go to commercial-docs/..., and that folder may exist before this runs);
 *   2. the FILES are moved: the whole folder renamed when commercial-docs does not exist yet, else merged file by file (a name that is taken is left behind, reported);
 *   3. the stored PATHS are rewritten, only for a file that really is at its new place, in one transaction.
 * A step that fails leaves the others' work in place and readable. The runner is docs/scripts/rename-commercial-docs-folder.cjs.
 */
import fs from 'fs';
import path from 'path';
import { COMMERCIAL_DOCS_FOLDER, COMMERCIAL_DOCS_LEGACY_FOLDER, getUploadRootDir } from '../utils/fileUpload';

/** The tables that store a path inside the Commercial Documents folder. */
export const COMMERCIAL_DOCS_PATH_TABLES = ['commercial_document_files', 'commercial_document_history'] as const;

/** The stored path under the new folder name; null when it is not under the old one. Only the first `COMMERCIAL DOCS/` segment is changed. */
export function toNewCommercialDocsStoredPath(stored: string): string | null {
  const s = String(stored ?? '');
  const m = /(^|[\\/])COMMERCIAL DOCS([\\/])/i.exec(s);
  if (!m) return null;
  return s.slice(0, m.index) + m[1] + COMMERCIAL_DOCS_FOLDER + m[2] + s.slice(m.index + m[0].length);
}

export function commercialDocsDirs(root: string = getUploadRootDir()): { oldDir: string; newDir: string } {
  return { oldDir: path.join(root, COMMERCIAL_DOCS_LEGACY_FOLDER), newDir: path.join(root, COMMERCIAL_DOCS_FOLDER) };
}

export interface TreeMoveResult {
  /** The old folder did not exist (nothing to do). */
  nothing: boolean;
  /** commercial-docs did not exist, so the folder was renamed in one step. */
  renamedWhole: boolean;
  moved: number;
  /** Files whose name was already taken in the new folder: left where they were. */
  collisions: string[];
}

function moveOne(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as { code?: string })?.code !== 'EXDEV') throw err;
    fs.copyFileSync(from, to);
    if (fs.statSync(to).size !== fs.statSync(from).size) {
      fs.unlinkSync(to);
      throw new Error('copy size mismatch');
    }
    fs.unlinkSync(from);
  }
}

function mergeDir(src: string, dst: string, rel: string, out: TreeMoveResult): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    const here = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      mergeDir(from, to, here, out);
    } else if (fs.existsSync(to)) {
      out.collisions.push(here);
    } else {
      moveOne(from, to);
      out.moved += 1;
    }
  }
  try {
    fs.rmdirSync(src); // only when everything in it moved
  } catch {
    /* something stays (a collision): the folder stays too */
  }
}

/** Moves the old folder's contents to the new one: one rename when the new folder does not exist, else a merge that never overwrites. */
export function moveCommercialDocsTree(root: string = getUploadRootDir()): TreeMoveResult {
  const { oldDir, newDir } = commercialDocsDirs(root);
  const out: TreeMoveResult = { nothing: false, renamedWhole: false, moved: 0, collisions: [] };
  if (!fs.existsSync(oldDir)) return { ...out, nothing: true };
  if (!fs.existsSync(newDir)) {
    fs.renameSync(oldDir, newDir);
    return { ...out, renamedWhole: true };
  }
  mergeDir(oldDir, newDir, '', out);
  return out;
}

export interface PathRow {
  id: string;
  file_path: string;
}

export interface PathUpdatePlan {
  table: string;
  id: string;
  from: string;
  to: string;
}

/** What to rewrite: a row under the old folder name whose file really is at the new place. Rows whose file is not there are returned apart, for a person to look at. */
export function planPathUpdates(
  table: string,
  rows: PathRow[],
  fileExists: (storedPath: string) => boolean,
): { updates: PathUpdatePlan[]; missing: PathRow[] } {
  const updates: PathUpdatePlan[] = [];
  const missing: PathRow[] = [];
  for (const row of rows) {
    const to = toNewCommercialDocsStoredPath(row.file_path);
    if (!to) continue;
    if (fileExists(to)) updates.push({ table, id: row.id, from: row.file_path, to });
    else missing.push(row);
  }
  return { updates, missing };
}

export interface TxClient {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount?: number | null }>;
}

/** Rewrites the planned paths in ONE transaction, each with a guard on the old value; anything off rolls everything back. Returns how many rows changed. */
export async function applyPathUpdates(client: TxClient, updates: PathUpdatePlan[]): Promise<number> {
  let changed = 0;
  await client.query('BEGIN');
  try {
    for (const u of updates) {
      const r = await client.query(`UPDATE ${u.table} SET file_path = $2 WHERE id = $1 AND file_path = $3`, [u.id, u.to, u.from]);
      if (!r.rowCount) throw new Error(`${u.table} ${u.id}: the row changed meanwhile`);
      changed += r.rowCount;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  return changed;
}

export function rollbackSqlForPathUpdates(updates: PathUpdatePlan[]): string[] {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return updates.map((u) => `UPDATE ${u.table} SET file_path = ${q(u.from)} WHERE id = ${q(u.id)} AND file_path = ${q(u.to)};`);
}
