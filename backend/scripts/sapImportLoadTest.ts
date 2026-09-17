/**
 * One-off load test for the SAP MASTER v2 import performance rewrite. Not part of the
 * regular test suite - run manually against a scratch DB (see AGENTS.md rollout notes) to
 * measure wall-clock time at realistic daily-file scale, both cold (first import, everything
 * new -> exercises full distributeToTables fan-out for every row) and warm (re-import of the
 * same file -> everything should hash-skip almost instantly, the common "unchanged daily
 * re-upload" case this rewrite targets) and a "1 changed row" case (mirrors a typical daily
 * delta file where a handful of POs actually moved).
 *
 * The real historical files under docs/ that use the MASTER v2 layout (e.g.
 * "Logistics Overview 13.10.2025 (Logic) - from IT.xlsx", "sample.xlsx") turn out to be mostly
 * blank template rows (~14.8k sheet rows but only ~22 rows carry real PO data), so they are not
 * representative of a real multi-thousand-row daily SAP file. This generates a synthetic
 * fixture at a configurable row count instead, using the same column layout validated against
 * the real importer in sapMasterV2ImportPerformance.integration.test.ts.
 *
 * Usage (PowerShell), pointed at a scratch/ephemeral Postgres, NOT the dev or SIT DB:
 *   $env:DB_HOST='localhost'; $env:DB_PORT='5435'; $env:DB_NAME='klip_loadtest';
 *   $env:DB_USER='postgres'; $env:DB_PASSWORD='postgres';
 *   npx ts-node scripts/sapImportLoadTest.ts 5000
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { SapMasterV2ImportService } from '../src/services/sapMasterV2Import.service';
import pool from '../src/database/connection';

const HEADERS = ['Contract No', 'PO No', 'Supplier', 'Product', 'Contract Quantity', 'Contract Qty UoM', 'Contract Ext No'];

function buildRows(rowCount: number, changedRowIndex: number | null): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const qty = i === changedRowIndex ? 9999 : 100 + (i % 500);
    rows.push([
      `LOADTEST-CTR-${i}`,
      `LOADTEST-PO-${i}`,
      'LoadTest-Supplier',
      i % 2 === 0 ? 'CPO' : 'PKO',
      String(qty),
      'MT',
      `EXT-${i}`,
    ]);
  }
  return rows;
}

function writeFixtureWorkbook(filePath: string, rows: (string | number)[][]): void {
  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Logistic Report');
  XLSX.writeFile(workbook, filePath);
}

async function timeImport(label: string, filePath: string) {
  const start = Date.now();
  const result = await SapMasterV2ImportService.importMasterV2File(filePath, { source: 'manual' });
  const elapsedMs = Date.now() - start;
  console.log(`\n=== ${label} ===`);
  console.log(`wall-clock: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`processed=${result.processedRecords} skipped=${result.skippedRecords ?? 0} failed=${result.failedRecords} total=${result.totalRecords}`);
  if (result.failedRecords > 0) {
    console.log('errors (first 5):', (result.errors ?? []).slice(0, 5));
  }
  return { result, elapsedMs };
}

async function main() {
  const rowCount = parseInt(process.argv[2] ?? '5000', 10);
  const tmpDir = os.tmpdir();
  const filePathCold = path.join(tmpDir, `loadtest-cold-${rowCount}.xlsx`);
  const filePathWarm = path.join(tmpDir, `loadtest-warm-${rowCount}.xlsx`); // byte-identical content, different file on disk
  const filePathDelta = path.join(tmpDir, `loadtest-delta-${rowCount}.xlsx`); // 1 row changed

  console.log(`Generating ${rowCount}-row fixtures...`);
  writeFixtureWorkbook(filePathCold, buildRows(rowCount, null));
  writeFixtureWorkbook(filePathWarm, buildRows(rowCount, null));
  writeFixtureWorkbook(filePathDelta, buildRows(rowCount, Math.floor(rowCount / 2)));

  try {
    const cold = await timeImport(`COLD import (${rowCount} rows, all new)`, filePathCold);
    const warm = await timeImport(`WARM import (${rowCount} rows, byte-identical -> should all hash-skip)`, filePathWarm);
    const delta = await timeImport(`DELTA import (${rowCount} rows, exactly 1 changed -> ${rowCount - 1} should hash-skip)`, filePathDelta);

    console.log('\n=== Summary ===');
    console.log(`Cold:  ${(cold.elapsedMs / 1000).toFixed(1)}s  processed=${cold.result.processedRecords} skipped=${cold.result.skippedRecords ?? 0} failed=${cold.result.failedRecords}`);
    console.log(`Warm:  ${(warm.elapsedMs / 1000).toFixed(1)}s  processed=${warm.result.processedRecords} skipped=${warm.result.skippedRecords ?? 0} failed=${warm.result.failedRecords}`);
    console.log(`Delta: ${(delta.elapsedMs / 1000).toFixed(1)}s  processed=${delta.result.processedRecords} skipped=${delta.result.skippedRecords ?? 0} failed=${delta.result.failedRecords}`);
    const speedup = warm.elapsedMs > 0 ? (cold.elapsedMs / warm.elapsedMs).toFixed(1) : 'N/A';
    console.log(`Warm/hash-skip speedup vs cold: ${speedup}x`);
    if (warm.result.failedRecords > 0 || delta.result.failedRecords > 0) {
      throw new Error('Load test produced unexpected failed rows - see errors above (possible deadlock/race from parallel chunking).');
    }
    if (delta.result.processedRecords !== 1) {
      throw new Error(`Delta import expected exactly 1 processed row, got ${delta.result.processedRecords}`);
    }
  } finally {
    for (const f of [filePathCold, filePathWarm, filePathDelta]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
