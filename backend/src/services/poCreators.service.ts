import fs from 'fs';
import path from 'path';
import { getClient, query } from '../database/connection';
import logger from '../utils/logger';
import {
  isPoCreatorsReportFile,
  pickNewestReport,
  readPoCreatorsWorkbook,
  type PoCreatorRow,
  type PoCreatorsRead,
} from '../utils/poCreatorsReport';
import { sapAutoImportOriginalDir, sha256File } from '../utils/sapAutoImportPaths';

/**
 * PO -> SAP creator for the COD dashboard, loaded from the ME2N report that IT drops in the share's Original folder (next to the daily
 * ZMMLOG_RPT export, which the SAP auto-import reads and this never touches). Two ways in, one result:
 *   - the schedule (PO_CREATORS_AUTO_LOAD_ENABLED, PO_CREATORS_AUTO_LOAD_CRON), like the SAP folder auto-import;
 *   - an administrator's "Check now" on the dashboard, or an upload of the file by hand (POST /commercial-documents/po-creators).
 * Every run leaves a row in commercial_po_creator_runs. A file already loaded (same bytes) is "unchanged": nothing is written.
 */

export type PoCreatorsRunOutcome = 'loaded' | 'unchanged' | 'no_file' | 'source_missing' | 'failed';
export type PoCreatorsTrigger = 'cron' | 'manual';

export type PoCreatorsRunResult = {
  outcome: PoCreatorsRunOutcome;
  fileName: string | null;
  rows: number;
  creators: number;
  conflicts: number;
  skipped: number;
  detail: string | null;
};

export function isPoCreatorsAutoLoadEnabled(): boolean {
  return String(process.env.PO_CREATORS_AUTO_LOAD_ENABLED || 'false').toLowerCase() === 'true';
}

const UPSERT_CHUNK = 2000;

/** Upsert PO -> creator pairs in one transaction (a PO already known takes the new creator). Returns how many pairs were written. */
export async function upsertPoCreators(rows: PoCreatorRow[], sourceFile: string | null, userId: string | null): Promise<number> {
  if (!rows.length) return 0;
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const part = rows.slice(i, i + UPSERT_CHUNK);
      await client.query(
        `INSERT INTO commercial_po_creators (po_number, created_by, source_file, loaded_by)
         SELECT t.po, t.by, $3, $4::uuid FROM unnest($1::text[], $2::text[]) AS t(po, by)
         ON CONFLICT (po_number) DO UPDATE
           SET created_by = EXCLUDED.created_by, source_file = EXCLUDED.source_file, loaded_at = CURRENT_TIMESTAMP, loaded_by = EXCLUDED.loaded_by`,
        [part.map((r) => r.po_number), part.map((r) => r.created_by), sourceFile, userId],
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Everything the run touches outside itself, so the branches can be tested without a share or a database. */
export type PoCreatorsDeps = {
  originalDir: () => string;
  dirExists: (dir: string) => boolean;
  listFiles: (dir: string) => Array<{ fileName: string; mtimeMs: number }>;
  hashFile: (filePath: string) => Promise<string>;
  readWorkbook: (filePath: string) => PoCreatorsRead | null;
  lastLoadedHash: () => Promise<string | null>;
  upsert: (rows: PoCreatorRow[], sourceFile: string, userId: string | null) => Promise<number>;
  recordRun: (run: {
    trigger: PoCreatorsTrigger;
    startedAt: Date;
    startedBy: string | null;
    result: PoCreatorsRunResult;
    fileHash: string | null;
    fileMtime: Date | null;
  }) => Promise<void>;
};

const defaultDeps: PoCreatorsDeps = {
  originalDir: sapAutoImportOriginalDir,
  dirExists: (dir) => fs.existsSync(dir),
  listFiles: (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && isPoCreatorsReportFile(e.name))
      .map((e) => ({ fileName: e.name, mtimeMs: fs.statSync(path.join(dir, e.name)).mtimeMs })),
  hashFile: sha256File,
  readWorkbook: (filePath) => readPoCreatorsWorkbook(fs.readFileSync(filePath)),
  lastLoadedHash: async () => {
    const r = await query(`SELECT file_hash FROM commercial_po_creator_runs WHERE outcome = 'loaded' ORDER BY started_at DESC LIMIT 1`);
    return r.rows[0]?.file_hash ? String(r.rows[0].file_hash) : null;
  },
  upsert: upsertPoCreators,
  recordRun: async ({ trigger, startedAt, startedBy, result, fileHash, fileMtime }) => {
    await query(
      `INSERT INTO commercial_po_creator_runs
         (trigger_source, started_at, finished_at, outcome, file_name, file_hash, file_mtime, rows_loaded, creators, conflicts, skipped, detail, started_by)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid)`,
      [trigger, startedAt, result.outcome, result.fileName, fileHash, fileMtime, result.rows, result.creators, result.conflicts, result.skipped, result.detail, startedBy],
    );
  },
};

let running = false;

const empty = (outcome: PoCreatorsRunOutcome, fileName: string | null, detail: string | null): PoCreatorsRunResult => ({
  outcome,
  fileName,
  rows: 0,
  creators: 0,
  conflicts: 0,
  skipped: 0,
  detail,
});

/**
 * Look in Original for the newest ME2N report; if it is new, load it. Never throws: a problem is the run's `failed` outcome, recorded.
 * Original is IT's read-only folder: this only reads from it.
 */
export async function runPoCreatorsAutoLoad(
  opts: { trigger: PoCreatorsTrigger; startedBy?: string | null },
  deps: PoCreatorsDeps = defaultDeps,
): Promise<PoCreatorsRunResult> {
  if (running) return empty('failed', null, 'A load is already running.');
  running = true;
  const startedAt = new Date();
  const startedBy = opts.startedBy ?? null;
  let fileHash: string | null = null;
  let fileMtime: Date | null = null;
  let result: PoCreatorsRunResult;
  try {
    const dir = deps.originalDir();
    if (!deps.dirExists(dir)) {
      result = empty('source_missing', null, `The folder is not there: ${dir}. Check SAP_AUTO_IMPORT_ROOT and that the share is mounted into the container.`);
    } else {
      const newest = pickNewestReport(deps.listFiles(dir));
      if (!newest) {
        result = empty('no_file', null, 'No ME2N report in the folder (the name must start with "ME2N from"). PO_CREATORS_FILE_PATTERN changes the pattern.');
      } else {
        const filePath = path.join(dir, newest.fileName);
        fileMtime = new Date(newest.mtimeMs);
        fileHash = await deps.hashFile(filePath);
        if (fileHash === (await deps.lastLoadedHash())) {
          result = empty('unchanged', newest.fileName, 'This file was already loaded.');
        } else {
          const read = deps.readWorkbook(filePath);
          if (!read) {
            result = empty('failed', newest.fileName, 'Not the ME2N report: the first sheet needs the columns "Purchasing Document" and "Created by".');
          } else if (!read.rows.length) {
            result = empty('failed', newest.fileName, 'The report has no PO with a creator.');
          } else {
            await deps.upsert(read.rows, newest.fileName, startedBy);
            result = {
              outcome: 'loaded',
              fileName: newest.fileName,
              rows: read.rows.length,
              creators: read.creators,
              conflicts: read.conflicts,
              skipped: read.skipped,
              detail: read.conflicts ? `${read.conflicts} PO(s) had two creators; the first was kept.` : null,
            };
          }
        }
      }
    }
  } catch (error) {
    logger.error('PO creators auto-load failed', { error: error instanceof Error ? error.message : String(error) });
    result = empty('failed', null, error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500));
  } finally {
    running = false;
  }
  try {
    await deps.recordRun({ trigger: opts.trigger, startedAt, startedBy, result, fileHash, fileMtime });
  } catch (error) {
    logger.error('PO creators auto-load: could not record the run', { error: error instanceof Error ? error.message : String(error) });
  }
  logger.info('PO creators auto-load finished', { trigger: opts.trigger, outcome: result.outcome, file: result.fileName, rows: result.rows });
  return result;
}

/** Cron entry: a no-op when PO_CREATORS_AUTO_LOAD_ENABLED is not true. Never throws. */
export async function runPoCreatorsAutoLoadJob(): Promise<PoCreatorsRunResult | null> {
  if (!isPoCreatorsAutoLoadEnabled()) {
    logger.info('PO creators auto-load cron skipped (PO_CREATORS_AUTO_LOAD_ENABLED is not true)');
    return null;
  }
  return runPoCreatorsAutoLoad({ trigger: 'cron' });
}

export type PoCreatorsRunInfo = { outcome: string; trigger: string; at: string; fileName: string | null; detail: string | null };

function runInfo(row: Record<string, unknown> | undefined): PoCreatorsRunInfo | null {
  if (!row) return null;
  return {
    outcome: String(row.outcome),
    trigger: String(row.trigger_source),
    at: new Date(String(row.at)).toISOString(),
    fileName: row.file_name ? String(row.file_name) : null,
    detail: row.detail ? String(row.detail) : null,
  };
}

/**
 * For the dashboard: the last run that LOADED a file ("loaded automatically on ...") and the last run of any kind, which is how a problem
 * shows ("the folder is not there"), since quiet runs ("unchanged") would otherwise hide it.
 */
export async function latestPoCreatorsRuns(): Promise<{ lastLoaded: PoCreatorsRunInfo | null; lastRun: PoCreatorsRunInfo | null }> {
  const cols = 'outcome, trigger_source, COALESCE(finished_at, started_at) AS at, file_name, detail';
  const [loaded, last] = await Promise.all([
    query(`SELECT ${cols} FROM commercial_po_creator_runs WHERE outcome = 'loaded' ORDER BY started_at DESC LIMIT 1`),
    query(`SELECT ${cols} FROM commercial_po_creator_runs ORDER BY started_at DESC LIMIT 1`),
  ]);
  return { lastLoaded: runInfo(loaded.rows[0]), lastRun: runInfo(last.rows[0]) };
}
