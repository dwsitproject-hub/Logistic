import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { SapMasterV2ImportService } from '../../services/sapMasterV2Import.service';
import { sha256File } from '../../utils/sapAutoImportPaths';

/**
 * End-to-end parity coverage for the SAP MASTER v2 import performance rewrite
 * (content-hash skip-unchanged-rows, batch prefetch, file-hash short-circuit, parallel
 * chunked processing - see the SAP Master V2 Import Performance plan). Runs the real
 * importer against a real Postgres instead of mocking the DB, because the behavior being
 * protected here is precisely "does the same file produce the same contracts/sap_processed_data
 * rows as before" - a mock would just prove the mock's own expectations.
 *
 * Guardrail under test: none of this should change contract/delivery quantity math or status
 * derivation - only remove wasted work for rows that did not actually change.
 */

const HEADERS = ['Contract No', 'PO No', 'Supplier', 'Product', 'Contract Quantity', 'Contract Qty UoM', 'Contract Ext No'];
const FILLER_ROW_COUNT = 60; // >= the 50-row parallelism threshold, so chunked workers are exercised.

interface FixtureRow {
  contractNo: string;
  poNo: string;
  supplier: string;
  product: string;
  qty: number;
  uom: string;
  extNo: string;
}

function buildRows(qtyForA1: number): FixtureRow[] {
  const rows: FixtureRow[] = [
    // Two POs sharing one contract number - proves partitionRowContextsByContractIdentity keeps
    // them in the same chunk and upsertContract merges them into a single contracts row even
    // under parallel chunked processing.
    { contractNo: 'ITEST-SAPPERF-CTR-A', poNo: 'ITEST-SAPPERF-PO-A1', supplier: 'IT-Supplier-Perf', product: 'CPO', qty: qtyForA1, uom: 'MT', extNo: 'EXT-A1' },
    { contractNo: 'ITEST-SAPPERF-CTR-A', poNo: 'ITEST-SAPPERF-PO-A2', supplier: 'IT-Supplier-Perf', product: 'CPO', qty: 2000, uom: 'MT', extNo: 'EXT-A2' },
    { contractNo: 'ITEST-SAPPERF-CTR-B', poNo: 'ITEST-SAPPERF-PO-B1', supplier: 'IT-Supplier-Perf', product: 'PKO', qty: 500, uom: 'MT', extNo: 'EXT-B1' },
  ];
  for (let i = 0; i < FILLER_ROW_COUNT; i++) {
    rows.push({
      contractNo: `ITEST-SAPPERF-CTR-F${i}`,
      poNo: `ITEST-SAPPERF-PO-F${i}`,
      supplier: 'IT-Supplier-Perf-Filler',
      product: 'CPO',
      qty: 100 + i,
      uom: 'MT',
      extNo: `EXT-F${i}`,
    });
  }
  return rows;
}

function writeFixtureWorkbook(filePath: string, rows: FixtureRow[]): void {
  const aoa = [
    HEADERS,
    ...rows.map((r) => [r.contractNo, r.poNo, r.supplier, r.product, String(r.qty), r.uom, r.extNo]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Logistic Report');
  XLSX.writeFile(workbook, filePath);
}

/**
 * sap_raw_data / sap_processed_data / sap_import_failures all FK to sap_data_imports with
 * ON DELETE CASCADE (migrations 003, 125), so deleting the sap_data_imports rows this suite
 * created is enough to clean up everything under them. The final query also mops up leftovers
 * from a previous failed run, where we no longer have the import ids on hand.
 */
async function cleanupFixtureData(importIds: string[] = []): Promise<void> {
  await query(`DELETE FROM contract_stos WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE 'ITEST-SAPPERF-%')`);
  await query(`DELETE FROM contracts WHERE contract_id LIKE 'ITEST-SAPPERF-%'`);
  if (importIds.length > 0) {
    await query(`DELETE FROM sap_data_imports WHERE id = ANY($1::uuid[])`, [importIds]);
  }
  await query(`
    DELETE FROM sap_data_imports
    WHERE id IN (SELECT DISTINCT import_id FROM sap_processed_data WHERE contract_number LIKE 'ITEST-SAPPERF-%')
  `);
}

describe('Integration: SAP MASTER v2 import performance rewrite (Phase 1-3 parity)', () => {
  const tmpDir = os.tmpdir();
  const filePathV1 = path.join(tmpDir, 'itest-sapperf-v1.xlsx');
  const filePathV1Copy = path.join(tmpDir, 'itest-sapperf-v1-copy.xlsx');
  const filePathV2 = path.join(tmpDir, 'itest-sapperf-v2-changed.xlsx');
  const createdImportIds: string[] = [];

  beforeAll(async () => {
    await cleanupFixtureData();
    writeFixtureWorkbook(filePathV1, buildRows(1000));
    writeFixtureWorkbook(filePathV1Copy, buildRows(1000)); // byte-identical content, separate file on disk
    writeFixtureWorkbook(filePathV2, buildRows(3000)); // ITEST-SAPPERF-PO-A1's qty changed 1000 -> 3000
  }, 30000);

  afterAll(async () => {
    await cleanupFixtureData(createdImportIds);
    for (const f of [filePathV1, filePathV1Copy, filePathV2]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('first import: every row is new, none skipped, contract A merges both its POs into one row', async () => {
    const result = await SapMasterV2ImportService.importMasterV2File(filePathV1, { source: 'manual' });
    if (result.importId) createdImportIds.push(result.importId);

    expect(result.success).toBe(true);
    expect(result.failedRecords).toBe(0);
    expect(result.skippedRecords ?? 0).toBe(0);
    expect(result.processedRecords).toBe(FILLER_ROW_COUNT + 3);

    const contractsA = await query(
      `SELECT id, po_number, quantity_ordered FROM contracts WHERE contract_id = 'ITEST-SAPPERF-CTR-A'`,
    );
    // Two POs (A1, A2) sharing one contract number must resolve to exactly one contracts row -
    // proves the parallel-chunk partitioning-by-contract-identity + advisory lock in
    // SapDataDistributionService.distributeData did not let two chunks race and duplicate it.
    expect(contractsA.rows.length).toBe(1);

    const hashes = await query(
      `SELECT content_hash FROM sap_processed_data WHERE contract_number LIKE 'ITEST-SAPPERF-%'`,
    );
    expect(hashes.rows.length).toBe(FILLER_ROW_COUNT + 3);
    for (const row of hashes.rows) {
      expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 60000);

  it('re-importing a byte-identical file skips every row via content_hash and marks sap_raw_data skipped', async () => {
    const fileSha256 = await sha256File(filePathV1Copy);
    const result = await SapMasterV2ImportService.importMasterV2File(filePathV1Copy, { source: 'manual', fileSha256 });
    if (result.importId) createdImportIds.push(result.importId);

    expect(result.success).toBe(true);
    expect(result.failedRecords).toBe(0);
    expect(result.processedRecords).toBe(0);
    expect(result.skippedRecords).toBe(FILLER_ROW_COUNT + 3);

    const importRow = await query(
      `SELECT processed_records, failed_records FROM sap_data_imports WHERE id = $1::uuid`,
      [result.importId],
    );
    // processed_records folds in skipped rows (see maybeRefreshImportProgress / final update).
    expect(Number(importRow.rows[0].processed_records)).toBe(FILLER_ROW_COUNT + 3);
    expect(Number(importRow.rows[0].failed_records)).toBe(0);

    const skippedRaw = await query(
      `SELECT COUNT(*)::int AS n FROM sap_raw_data WHERE import_id = $1::uuid AND status = 'skipped'`,
      [result.importId],
    );
    expect(Number(skippedRaw.rows[0].n)).toBe(FILLER_ROW_COUNT + 3);
  }, 60000);

  it('a changed row is reprocessed (not skipped) and the new contract quantity is actually written', async () => {
    // PO-A1 and PO-A2 share one contract row (ITEST-SAPPERF-CTR-A); upsertContract overwrites
    // contracts.quantity_ordered with whichever PO's own row it last processed - it is not a
    // sum across POs. So instead of asserting against that order-dependent aggregate, assert
    // directly against PO-A1's own sap_processed_data row, which deterministically proves this
    // specific row was actually reprocessed (not skipped) with its new quantity.
    const beforeRow = await query(
      `SELECT data->'contract'->>'contract_quantity' AS qty FROM sap_processed_data WHERE po_number = 'ITEST-SAPPERF-PO-A1'`,
    );
    expect(Number(beforeRow.rows[0].qty)).toBe(1000);

    const fileSha256V2 = await sha256File(filePathV2);
    const result = await SapMasterV2ImportService.importMasterV2File(filePathV2, { source: 'manual', fileSha256: fileSha256V2 });
    if (result.importId) createdImportIds.push(result.importId);

    expect(result.success).toBe(true);
    expect(result.failedRecords).toBe(0);
    // Exactly one row changed (PO-A1's quantity 1000 -> 3000); every other row is still
    // byte-identical to what v1/v1-copy already wrote.
    expect(result.processedRecords).toBe(1);
    expect(result.skippedRecords).toBe(FILLER_ROW_COUNT + 3 - 1);

    const afterRow = await query(
      `SELECT data->'contract'->>'contract_quantity' AS qty FROM sap_processed_data WHERE po_number = 'ITEST-SAPPERF-PO-A1'`,
    );
    expect(Number(afterRow.rows[0].qty)).toBe(3000);

    // PO-A1 was the row actually reprocessed by distributeToTables in this import, so
    // contracts.quantity_ordered (last-writer-wins across the merged POs) must reflect its new
    // value normalized MT -> KG, proving the write path really ran for the changed row.
    const contractAfter = await query(
      `SELECT quantity_ordered FROM contracts WHERE contract_id = 'ITEST-SAPPERF-CTR-A'`,
    );
    expect(Number(contractAfter.rows[0].quantity_ordered)).toBeCloseTo(3000 * 1000, 5);
  }, 60000);

  it('findCompletedImportByFileHash finds the prior completed import for a byte-identical file, and a different file has a different hash', async () => {
    const hashV1Copy = await sha256File(filePathV1Copy);
    const hashV2 = await sha256File(filePathV2);
    expect(hashV1Copy).not.toBe(hashV2);

    const found = await SapMasterV2ImportService.findCompletedImportByFileHash(hashV1Copy);
    expect(found).not.toBeNull();
    expect(found?.failedRecords).toBe(0);
    expect(found?.totalRecords).toBe(FILLER_ROW_COUNT + 3);
  });

  it('re-uploading the exact same bytes as an already-completed file resolves via hash lookup instead of reprocessing', async () => {
    // Simulates the manual-upload controller's short-circuit: hash the incoming file and check
    // for a prior clean completed import before ever calling queueMasterV2FileImport.
    const incomingHash = await sha256File(filePathV2);
    const found = await SapMasterV2ImportService.findCompletedImportByFileHash(incomingHash);
    expect(found).not.toBeNull();
    expect(found?.importId).toBeTruthy();
  });

  it('requestCancelImport stops an in-flight queued import and marks it cancelled, not completed', async () => {
    const cancelFile = path.join(tmpDir, 'itest-sapperf-cancel.xlsx');
    writeFixtureWorkbook(cancelFile, buildRows(1000));
    try {
      const queued = await SapMasterV2ImportService.queueMasterV2FileImport(cancelFile, {
        source: 'manual',
        keepSourceFile: true,
      });
      createdImportIds.push(queued.importId);

      const cancelResult = await SapMasterV2ImportService.requestCancelImport(queued.importId);
      expect(cancelResult.accepted).toBe(true);
      expect(cancelResult.status).toBe('cancelled');

      // Status must flip immediately so the dashboard can leave "Cancelling..." without
      // waiting for parse/prefetch/bulk-insert to finish.
      const immediate = await query(`SELECT status FROM sap_data_imports WHERE id = $1::uuid`, [queued.importId]);
      expect(String(immediate.rows[0]?.status)).toBe('cancelled');

      let status = 'cancelled';
      for (let i = 0; i < 80; i++) {
        const row = await query(`SELECT status FROM sap_data_imports WHERE id = $1::uuid`, [queued.importId]);
        status = String(row.rows[0]?.status || '');
        if (status === 'cancelled') break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      expect(status).toBe('cancelled');

      const alreadyDone = await SapMasterV2ImportService.requestCancelImport(queued.importId);
      expect(alreadyDone.accepted).toBe(true);
      expect(alreadyDone.status).toBe('cancelled');
    } finally {
      if (fs.existsSync(cancelFile)) fs.unlinkSync(cancelFile);
    }
  }, 60000);
});
