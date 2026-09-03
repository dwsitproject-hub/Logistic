import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import pool from '../database/connection';
import logger from '../utils/logger';
import {
  SAP_MASTER_V2_UAT_FIELD_MAPPING,
  applySapMasterV2RawFieldAliases,
  isSapMasterV2UatFlatHeaderRow,
  isTruckingQuantityField,
  resolveSapMasterV2QualityLocation,
} from '../utils/sapMasterV2UatFormat';
import { SapDataDistributionService } from './sapDataDistribution.service';
import { invalidateShipmentsListCache } from './shipmentList.service';
import { invalidateTruckingListCache } from './truckingList.service';
import { invalidateShippingPerformanceRowCache } from './shippingPerformance.service';
import { normalizePoNumber, shipmentPoSapIdKey } from '../utils/contractPoIdentity';
import { applyAbsenceForImport, evaluateImportTrust } from './sapAbsenceTracking.service';
import { applyPresenceState } from './sapPresence.service';
import { identityFromParsedSapRow, type SapAutoImportIdentityRow } from '../utils/sapAutoImportIdentity';
import {
  dedupeImportRetryRows,
  formatSapImportRowError,
  isFollowOnAbortedTransactionError,
  isRetryableFollowOnImportError,
  mergeFollowOnRetryCounts,
} from '../utils/sapImportRowError';

export interface MasterV2Config {
  filePath: string;
  sheetName: string;
  legendRow1: number; // Row 2 (index 1)
  legendRow2: number; // Row 3 (index 2)
  headerRow: number;  // Row 5 (index 4)
  sapFieldRow1: number; // Row 7 (index 6)
  sapFieldRow2: number; // Row 8 (index 7)
  dataStartRow: number; // Row 9 (index 8)
}

export type SapImportSource = 'manual' | 'scheduler';

export interface QueueMasterV2FileImportOptions {
  source?: SapImportSource;
  keepSourceFile?: boolean;
  /** SHA-256 of the uploaded file, persisted so a future identical re-upload can short-circuit. */
  fileSha256?: string;
  /** Original uploaded file name (basename), shown on the SAP Data import history. */
  fileName?: string;
}

export interface ImportMasterV2FileOptions {
  source?: SapImportSource;
  /** SHA-256 of the file, persisted so findCompletedImportByFileHash can find this import later. */
  fileSha256?: string;
  /** Original uploaded file name (basename), shown on the SAP Data import history. */
  fileName?: string;
}

/** Result of looking up a prior completed import by file hash (manual-upload short-circuit). */
export interface CompletedImportByFileHash {
  importId: string;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  skippedRecords: number;
}

/** Pure, in-memory parse of one Excel row, plus the identity keys used to batch-prefetch/skip. */
interface RowImportContext {
  rowIndex: number;
  row: any[];
  parsedData: any;
  rowIdentity: SapAutoImportIdentityRow | null;
  contractNumber: string | null;
  poNumber: string | null;
  stoKey: string;
  /** SHA-256 of parsedData; null when poNumber is missing (row will fail validation anyway). */
  contentHash: string | null;
}

/** Per-chunk accumulator, aggregated across all parallel workers once every chunk finishes. */
interface ChunkImportResult {
  processedRecords: number;
  failedRecords: number;
  skippedRecords: number;
  /** Rows this chunk never got to because a cancel request came in mid-chunk (see runImportChunk). */
  cancelledRecords: number;
  /** True if this chunk stopped early because the import was cancelled, rather than finishing all its rows. */
  wasCancelled: boolean;
  errors: string[];
  successIdentities: SapAutoImportIdentityRow[];
  failedIdentities: SapAutoImportIdentityRow[];
  /** Already-counted failures caused only by an aborted sibling row — safe to retry once. */
  retryableFailedRows: RowImportContext[];
  /** Rows never attempted after the chunk TX aborted — also safe to retry once. */
  unprocessedAfterAbortRows: RowImportContext[];
  summary: {
    contractsCreated: number;
    shipmentsCreated: number;
    qualitySurveysCreated: number;
    truckingOperationsCreated: number;
    paymentsCreated: number;
  };
}

const emptyChunkSummary = () => ({
  contractsCreated: 0,
  shipmentsCreated: 0,
  qualitySurveysCreated: 0,
  truckingOperationsCreated: 0,
  paymentsCreated: 0,
});

/** In-process cancel flags for in-flight imports. Workers poll this between rows (no DB round trip). */
const cancelRequestedImportIds = new Set<string>();

export interface SapMasterV2ImportResult {
  success: boolean;
  importId?: string;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  skippedRecords?: number;
  cancelled?: boolean;
  errors?: string[];
  successIdentities?: SapAutoImportIdentityRow[];
  failedIdentities?: SapAutoImportIdentityRow[];
  summary?: {
    contractsCreated: number;
    shipmentsCreated: number;
    qualitySurveysCreated: number;
    truckingOperationsCreated: number;
    paymentsCreated: number;
  };
}

export interface FieldMetadata {
  columnIndex: number;
  index: number;
  headerName: string;
  sapSource1: string;
  sapSource2: string;
  userRole: string;
  isFromSap: boolean;
  isManualEntry: boolean;
  isCalculated: boolean;
}

interface MasterV2WorkbookData {
  fieldMetadata: FieldMetadata[];
  validDataRows: any[][];
  sheetName: string;
}

export class SapMasterV2ImportService {
  
  private static DEFAULT_CONFIG: MasterV2Config = {
    filePath: '',
    sheetName: 'Logistic Report', // Updated to new template name - falls back to first sheet if not found
    legendRow1: 0,  // Row 1 in Excel (0-indexed) - actual headers
    legendRow2: 0,  // Row 1 - same as headers
    headerRow: 0,   // Row 1 - actual headers
    sapFieldRow1: 0, // Row 1 - same as headers
    sapFieldRow2: 0, // Row 1 - same as headers
    dataStartRow: 1  // Row 2 - first data row
  };
  
  /**
   * Parse workbook from disk (throws on invalid file/sheet before any DB write).
   */
  private static loadMasterV2WorkbookData(filePath: string): MasterV2WorkbookData {
    const workbook = XLSX.readFile(filePath);
    let sheetName = this.DEFAULT_CONFIG.sheetName;
    if (!workbook.SheetNames.includes(sheetName)) {
      sheetName = workbook.SheetNames.includes('MASTER v2')
        ? 'MASTER v2'
        : workbook.SheetNames[0];
    }
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: false,
    }) as any[][];

    const config = this.resolveWorkbookConfig(jsonData);
    const fieldMetadata = this.parseFieldMetadata(jsonData, config);
    const dataRows = jsonData.slice(config.dataStartRow);
    const validDataRows = dataRows.filter(
      (row) => row && row.some((cell) => cell !== null && cell !== undefined && cell !== '')
    );

    logger.info('Excel file loaded', { totalRows: jsonData.length, sheetName, dataRows: validDataRows.length });

    return { fieldMetadata, validDataRows, sheetName };
  }

  /** Detect UAT flat header (82 cols) vs legacy multi-row MASTER v2 template. */
  private static resolveWorkbookConfig(jsonData: any[][]): MasterV2Config {
    if (isSapMasterV2UatFlatHeaderRow(jsonData[0] ?? [])) {
      return { ...this.DEFAULT_CONFIG };
    }
    // Legacy template: metadata rows 0-7, headers row 8, data from row 9
    const legacyHeaderIdx = jsonData.findIndex((row, idx) =>
      idx > 0 &&
      Array.isArray(row) &&
      row.some((cell) => String(cell ?? '').toLowerCase().includes('contract no')),
    );
    if (legacyHeaderIdx >= 0) {
      return {
        ...this.DEFAULT_CONFIG,
        legendRow1: Math.max(0, legacyHeaderIdx - 2),
        legendRow2: Math.max(0, legacyHeaderIdx - 1),
        headerRow: legacyHeaderIdx,
        sapFieldRow1: legacyHeaderIdx,
        sapFieldRow2: legacyHeaderIdx,
        dataStartRow: legacyHeaderIdx + 1,
      };
    }
    return { ...this.DEFAULT_CONFIG };
  }

  private static isCancelRequested(importId: string): boolean {
    return cancelRequestedImportIds.has(importId);
  }

  private static clearCancelRequest(importId: string): void {
    cancelRequestedImportIds.delete(importId);
  }

  /**
   * Ask an in-flight import to stop. Status is flipped to `cancelled` immediately so the
   * dashboard / in-flight guard unblocks without waiting for the worker to finish the
   * current parse/prefetch/bulk-insert (those steps cannot be aborted mid-query). The
   * in-memory flag then lets the worker exit as soon as it next checks, skip
   * absence/presence, and leave already-committed SAVEPOINTs as-is.
   */
  static async requestCancelImport(importId: string): Promise<{
    accepted: boolean;
    status: string;
    message: string;
  }> {
    const result = await pool.query(
      `SELECT id, status FROM sap_data_imports WHERE id = $1::uuid`,
      [importId],
    );
    if (result.rows.length === 0) {
      return { accepted: false, status: 'not_found', message: 'Import not found' };
    }
    const status = String(result.rows[0].status || '');
    if (status === 'cancelled') {
      cancelRequestedImportIds.add(importId);
      return {
        accepted: true,
        status: 'cancelled',
        message: 'Import is already cancelled.',
      };
    }
    if (status !== 'processing' && status !== 'pending') {
      return {
        accepted: false,
        status,
        message: `Import is already ${status} and cannot be cancelled.`,
      };
    }
    cancelRequestedImportIds.add(importId);
    await pool.query(
      `UPDATE sap_data_imports
          SET status = 'cancelled',
              error_log = COALESCE(error_log, $1)
        WHERE id = $2::uuid
          AND status IN ('processing', 'pending')`,
      [JSON.stringify(['Import cancelled by user. Remaining rows will stop shortly.']), importId],
    );
    logger.info('SAP MASTER v2 import cancel requested', { importId, previousStatus: status });
    return {
      accepted: true,
      status: 'cancelled',
      message: 'Import cancelled. Remaining rows will stop shortly.',
    };
  }

  private static async markImportFailed(importId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await pool.query(
        `UPDATE sap_data_imports
         SET status = 'failed', error_log = $1
         WHERE id = $2
           AND status IN ('processing', 'pending')`,
        [JSON.stringify([message]), importId]
      );
    } catch (updateErr) {
      logger.error('Failed to mark SAP import as failed', { importId, updateErr });
    }
  }

  private static sanitizeImportFileName(fileName: string | null | undefined): string | null {
    const base = path.basename(String(fileName || '').trim());
    return base.length > 0 ? base.slice(0, 512) : null;
  }

  private static async createProcessingImport(
    totalRecords: number,
    source: SapImportSource = 'manual',
    fileSha256: string | null = null,
    fileName: string | null = null,
  ): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const importResult = await client.query(
        `INSERT INTO sap_data_imports (import_date, status, total_records, source, file_sha256, file_name)
         VALUES (CURRENT_DATE, 'processing', $1, $2, $3, $4)
         RETURNING id`,
        [totalRecords, source === 'scheduler' ? 'scheduler' : 'manual', fileSha256, fileName],
      );
      await client.query('COMMIT');
      return importResult.rows[0].id as string;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Look up a previously *completed* (zero failed rows) import that already processed this
   * exact file, by SHA-256. Manual-upload equivalent of the scheduler folder auto-import's
   * sap_auto_import_files dedupe. Callers use this to short-circuit before even parsing/queuing
   * a re-upload of a file nothing has changed in.
   */
  static async findCompletedImportByFileHash(
    fileSha256: string,
  ): Promise<CompletedImportByFileHash | null> {
    const result = await pool.query(
      `SELECT id, total_records, processed_records, failed_records
       FROM sap_data_imports
       WHERE file_sha256 = $1
         AND status = 'completed'
         AND failed_records = 0
       ORDER BY import_timestamp DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [fileSha256],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const totalRecords = Number(row.total_records) || 0;
    const processedRecords = Number(row.processed_records) || 0;
    return {
      importId: row.id as string,
      totalRecords,
      processedRecords,
      failedRecords: Number(row.failed_records) || 0,
      // processed_records already folds in hash-skipped rows (see maybeRefreshImportProgress /
      // the final sap_data_imports update below); there is no separate stored skipped count.
      skippedRecords: Math.max(0, totalRecords - processedRecords),
    };
  }

  /**
   * Queue a file import: validate + create DB record, then process rows in the background.
   * Returns quickly so nginx/proxy timeouts do not abort long imports (~5000+ rows).
   */
  static async queueMasterV2FileImport(
    filePath: string,
    options: QueueMasterV2FileImportOptions = {},
  ): Promise<{ importId: string; totalRecords: number }> {
    const { fieldMetadata, validDataRows } = this.loadMasterV2WorkbookData(filePath);
    const source = options.source === 'scheduler' ? 'scheduler' : 'manual';
    const keepSourceFile = options.keepSourceFile === true;
    const importId = await this.createProcessingImport(
      validDataRows.length,
      source,
      options.fileSha256 ?? null,
      this.sanitizeImportFileName(options.fileName ?? filePath),
    );

    setImmediate(() => {
      void (async () => {
        try {
          await this.processMasterV2Import(importId, validDataRows, fieldMetadata);
          logger.info('SAP MASTER v2 background import completed', { importId });
        } catch (error) {
          logger.error('SAP MASTER v2 background import failed', { importId, error });
          await this.markImportFailed(importId, error);
        } finally {
          if (!keepSourceFile && fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (unlinkErr) {
              logger.warn('Failed to delete temp SAP upload file', { filePath, unlinkErr });
            }
          }
        }
      })();
    });

    return { importId, totalRecords: validDataRows.length };
  }

  /**
   * Import data from SAP MASTER v2 Excel file (blocks until all rows are processed).
   */
  static async importMasterV2File(
    filePath: string,
    options: ImportMasterV2FileOptions = {},
  ): Promise<SapMasterV2ImportResult> {
    const { fieldMetadata, validDataRows } = this.loadMasterV2WorkbookData(filePath);
    const source = options.source === 'scheduler' ? 'scheduler' : 'manual';
    const importId = await this.createProcessingImport(
      validDataRows.length,
      source,
      options.fileSha256 ?? null,
      this.sanitizeImportFileName(options.fileName ?? filePath),
    );
    return this.processMasterV2Import(importId, validDataRows, fieldMetadata);
  }

  /** SHA-256 of parsedData; deterministic for a fixed sheet layout (same field iteration order). */
  private static computeRowContentHash(parsedData: any): string {
    return crypto.createHash('sha256').update(JSON.stringify(parsedData)).digest('hex');
  }

  private static processedDataKey(poNumber: string, stoKey: string): string {
    return `${poNumber}\u0000${stoKey}`;
  }

  /** Pure, in-memory parse of every row up front (no DB calls) so prefetch/bulk-insert below can run before any per-row work starts. */
  private static buildRowContexts(
    validDataRows: any[][],
    fieldMetadata: FieldMetadata[],
    importId?: string,
  ): RowImportContext[] {
    const contexts: RowImportContext[] = [];
    for (let i = 0; i < validDataRows.length; i++) {
      if (importId && i > 0 && i % 200 === 0 && this.isCancelRequested(importId)) {
        break;
      }
      const row = validDataRows[i];
      const parsedData = this.parseDataRow(row, fieldMetadata);
      const rowIdentity = identityFromParsedSapRow(parsedData);
      const contractNumber = parsedData.contract?.contract_no
        ? String(parsedData.contract.contract_no).trim() || null
        : null;
      const poNumber = normalizePoNumber(parsedData.contract?.po_no);
      const stoNumberRaw = parsedData.shipment?.sto_no || parsedData.contract?.sto_no || null;
      const stoKey = String(stoNumberRaw ?? '').trim();
      // contentHash is computed below, after applyDuplicateStoQuantitySums has had a chance to
      // rewrite quantity fields - it must hash what actually gets stored, not the pre-sum values.
      contexts.push({ rowIndex: i, row, parsedData, rowIdentity, contractNumber, poNumber, stoKey, contentHash: null });
    }

    // Same-file split-STO rows: when 2+ rows share the exact same PO+STO (one STO's cargo
    // reported across multiple lines, e.g. partial deliveries), sum their STO/trucking quantity
    // fields into every row of the group. This must run before hashing below, and before the
    // rows are ever sent to runImportChunk - see applyDuplicateStoQuantitySums for what is (and
    // isn't) covered.
    this.applyDuplicateStoQuantitySums(contexts);

    for (const ctx of contexts) {
      ctx.contentHash = ctx.poNumber ? this.computeRowContentHash(ctx.parsedData) : null;
    }

    return contexts;
  }

  /** Numeric-safe parse tolerant of thousands separators/whitespace, matching parseNumber's leniency. */
  private static parseNumberLoose(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const cleaned = typeof value === 'string' ? value.replace(/[,\s]/g, '') : value;
    const num = parseFloat(cleaned as any);
    return Number.isNaN(num) ? null : num;
  }

  /**
   * When 2+ rows in this file share the exact same PO+STO, SAP has reported that one STO's
   * cargo across multiple lines (e.g. partial deliveries) rather than one line per STO. Left
   * alone, only the row processed last would end up stored (see runImportChunk's "changed row"
   * COALESCE-overwrite path) - or, before the existingProcessedMap fix above, every row after the
   * first would fail outright on the sap_processed_po_sto_uidx unique index. Either way the other
   * lines' quantities were lost. This sums those quantities across the whole group and writes the
   * SAME total back into every row of the group, so whichever row is processed last (order is not
   * guaranteed) always writes the correct total - and re-uploading the same file later recomputes
   * the same total from scratch rather than adding onto whatever is already stored, so it stays
   * safe to re-import.
   *
   * Scope, by explicit product decision: sums `sto_quantity` (contracts/contract_stos) and the
   * trucking `quantity_sent_via_trucking_based_on_surat_jalan` / `quantity_delivered_via_trucking`
   * fields (per location sequence - see addTruckingData). `contract.contract_quantity` is
   * deliberately left untouched: it is one value per contract/PO, not per STO line. Rows that
   * carry no parsedData.trucking[] entries at all (pure SEA rows relying only on shipment-level
   * vessel delivery/receive fields) are not covered by this pass.
   */
  private static applyDuplicateStoQuantitySums(contexts: RowImportContext[]): void {
    const groups = new Map<string, RowImportContext[]>();
    for (const ctx of contexts) {
      if (!ctx.poNumber) continue;
      const key = this.processedDataKey(ctx.poNumber, ctx.stoKey);
      const group = groups.get(key);
      if (group) {
        group.push(ctx);
      } else {
        groups.set(key, [ctx]);
      }
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;

      // 1. sto_quantity: one summed total, written onto every row's contract/shipment object.
      let stoQtySum = 0;
      let sawStoQty = false;
      for (const ctx of group) {
        const raw = ctx.parsedData.contract?.sto_quantity ?? ctx.parsedData.shipment?.sto_quantity;
        const num = this.parseNumberLoose(raw);
        if (num !== null) {
          stoQtySum += num;
          sawStoQty = true;
        }
      }
      if (sawStoQty) {
        for (const ctx of group) {
          if (ctx.parsedData.contract) ctx.parsedData.contract.sto_quantity = stoQtySum;
          if (ctx.parsedData.shipment) ctx.parsedData.shipment.sto_quantity = stoQtySum;
        }
      }

      // 2. Trucking sent/delivered quantity, summed per location sequence across the whole group
      // (sequence comes from addTruckingData: 1 unless the column says "Location 2"/"Location 3").
      const sentBySeq = new Map<number, number>();
      const deliveredBySeq = new Map<number, number>();
      for (const ctx of group) {
        const entries: any[] = Array.isArray(ctx.parsedData.trucking) ? ctx.parsedData.trucking : [];
        for (const entry of entries) {
          const seq = Number(entry?.sequence) || 1;
          const sent = this.parseNumberLoose(entry?.data?.quantity_sent_via_trucking_based_on_surat_jalan);
          if (sent !== null) sentBySeq.set(seq, (sentBySeq.get(seq) ?? 0) + sent);
          const delivered = this.parseNumberLoose(entry?.data?.quantity_delivered_via_trucking);
          if (delivered !== null) deliveredBySeq.set(seq, (deliveredBySeq.get(seq) ?? 0) + delivered);
        }
      }
      if (sentBySeq.size === 0 && deliveredBySeq.size === 0) continue;
      for (const ctx of group) {
        const entries: any[] = Array.isArray(ctx.parsedData.trucking) ? ctx.parsedData.trucking : [];
        for (const entry of entries) {
          if (!entry?.data) continue;
          const seq = Number(entry?.sequence) || 1;
          if (sentBySeq.has(seq)) {
            entry.data.quantity_sent_via_trucking_based_on_surat_jalan = sentBySeq.get(seq);
          }
          if (deliveredBySeq.has(seq)) {
            entry.data.quantity_delivered_via_trucking = deliveredBySeq.get(seq);
          }
        }
      }
    }
  }

  /**
   * One query for every distinct PO+STO in the file instead of one SELECT per row (this used
   * to run inside the per-row loop). Safe to run before any writes: rows sharing a PO+STO are
   * always kept in the same parallel chunk (see partitionRowContextsByContractIdentity), so no
   * chunk can race another to update the same sap_processed_data row within one import run.
   */
  private static async prefetchExistingProcessedData(
    rows: RowImportContext[],
    importId?: string,
  ): Promise<Map<string, { id: string; contentHash: string | null }>> {
    const map = new Map<string, { id: string; contentHash: string | null }>();
    if (importId && this.isCancelRequested(importId)) return map;
    const uniquePairs = new Map<string, { po: string; sto: string }>();
    for (const r of rows) {
      if (!r.poNumber) continue;
      const key = this.processedDataKey(r.poNumber, r.stoKey);
      if (!uniquePairs.has(key)) uniquePairs.set(key, { po: r.poNumber, sto: r.stoKey });
    }
    if (uniquePairs.size === 0) return map;

    const pos: string[] = [];
    const stos: string[] = [];
    for (const { po, sto } of uniquePairs.values()) {
      pos.push(po);
      stos.push(sto);
    }

    const result = await pool.query(
      `SELECT spd.id, spd.content_hash,
              TRIM(COALESCE(spd.po_number::text, '')) AS po_key,
              COALESCE(NULLIF(TRIM(COALESCE(spd.sto_number::text, '')), ''), '') AS sto_key
       FROM sap_processed_data spd
       JOIN unnest($1::text[], $2::text[]) AS k(po, sto)
         ON TRIM(COALESCE(spd.po_number::text, '')) = k.po
        AND COALESCE(NULLIF(TRIM(COALESCE(spd.sto_number::text, '')), ''), '') = k.sto`,
      [pos, stos],
    );

    for (const row of result.rows as Array<{
      id: string;
      content_hash: string | null;
      po_key: string;
      sto_key: string;
    }>) {
      map.set(this.processedDataKey(row.po_key, row.sto_key), {
        id: row.id,
        contentHash: row.content_hash ?? null,
      });
    }
    return map;
  }

  /**
   * One query for every distinct (PO number, SAP shipment/STO id) pair in the file instead of one
   * SELECT per row for upsertShipment's first, most common candidate-match step (exact
   * shipment_id on the row's contract). Only this step is prefetched - the other 6 fallback
   * cascade steps (KLIP-planned supersede, SAP-only supersede, vessel-name similarity, planned
   * MNL/MSEA reuse, sole-active reuse) read sibling/global shipment state that earlier rows in
   * this same chunk may have just changed, so they stay as live queries; only run when the exact
   * match here misses (a minority of rows).
   *
   * Joins through contracts.po_number rather than a shipment's contract_id, because a row's own
   * contractUuid is not resolved until upsertContract runs mid-row - po_number is known up front
   * from the parsed row context, before any writes happen this run. Callers MUST still verify a
   * hit's contract_id matches their own resolved contractUuid before trusting it (contract
   * identity can still change mid-chunk via placeholder rename/merge in upsertContract) and fall
   * back to the live query otherwise - see upsertShipment.
   */
  private static async prefetchExistingShipmentsByPoAndSapId(
    rows: RowImportContext[],
    importId?: string,
  ): Promise<Map<string, { id: string; contractId: string }>> {
    const map = new Map<string, { id: string; contractId: string }>();
    if (importId && this.isCancelRequested(importId)) return map;
    const uniquePairs = new Map<string, { po: string; sid: string }>();
    for (const r of rows) {
      if (!r.poNumber) continue;
      const shipmentIdFromSap = (r.parsedData?.shipment?.shipment_id || r.parsedData?.shipment?.sto_no) as
        | string
        | undefined;
      const sid = String(shipmentIdFromSap ?? '').trim();
      if (!sid) continue;
      const key = shipmentPoSapIdKey(r.poNumber, sid);
      if (!uniquePairs.has(key)) uniquePairs.set(key, { po: r.poNumber, sid });
    }
    if (uniquePairs.size === 0) return map;

    const pos: string[] = [];
    const sids: string[] = [];
    for (const { po, sid } of uniquePairs.values()) {
      pos.push(po);
      sids.push(sid);
    }

    const result = await pool.query(
      `SELECT s.id, s.contract_id::text AS contract_id,
              TRIM(COALESCE(c.po_number::text, '')) AS po_key,
              s.shipment_id AS sid_key
       FROM shipments s
       JOIN contracts c ON c.id = s.contract_id
       JOIN unnest($1::text[], $2::text[]) AS k(po, sid)
         ON TRIM(COALESCE(c.po_number::text, '')) = k.po
        AND s.shipment_id = k.sid`,
      [pos, sids],
    );

    for (const row of result.rows as Array<{ id: string; contract_id: string; po_key: string; sid_key: string }>) {
      map.set(shipmentPoSapIdKey(row.po_key, row.sid_key), { id: row.id, contractId: row.contract_id });
    }
    return map;
  }

  /**
   * One (or a few, chunked) multi-row INSERT for every row's sap_raw_data instead of one INSERT
   * per row. Deliberately runs via `pool` (auto-committed), decoupled from every row's own
   * SAVEPOINT: a row that later fails now keeps its raw JSON (the failure UPDATE below actually
   * matches it, instead of silently no-op'ing because ROLLBACK TO SAVEPOINT already erased the
   * insert) - a strict audit improvement, not a change to any calculation. One side effect: if
   * the import fails outright before finishing, these staging rows persist tagged to a 'failed'
   * sap_data_imports row, instead of vanishing with the rest of that one aborted transaction.
   */
  private static async bulkInsertRawData(
    importId: string,
    rows: RowImportContext[],
  ): Promise<string[]> {
    const rawDataIds: string[] = new Array(rows.length);
    const BATCH_SIZE = 500;
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      if (this.isCancelRequested(importId)) {
        break;
      }
      const batch = rows.slice(start, start + BATCH_SIZE);
      const valueClauses: string[] = [];
      const params: unknown[] = [];
      batch.forEach((ctx, idx) => {
        const base = idx * 3;
        valueClauses.push(`($${base + 1}, $${base + 2}, $${base + 3}, 'pending')`);
        params.push(importId, ctx.rowIndex + 1, JSON.stringify(ctx.row));
      });
      const result = await pool.query(
        `INSERT INTO sap_raw_data (import_id, row_number, data, status)
         VALUES ${valueClauses.join(', ')}
         RETURNING id`,
        params,
      );
      result.rows.forEach((row, idx) => {
        rawDataIds[batch[idx].rowIndex] = row.id as string;
      });
    }
    return rawDataIds;
  }

  /** How many parallel chunk workers to run. `SAP_IMPORT_PARALLELISM=1` restores the old fully-serial path. */
  private static resolveImportParallelism(rowCount: number): number {
    if (rowCount < 50) return 1; // not worth extra connections/coordination for a tiny file
    // Default raised 4 -> 6 now that the master_vessels deadlock (ensureMasterVesselFromSap
    // racing across chunks - see masterVesselFromSap.service.ts) is fixed via advisory lock +
    // savepoint; more concurrent chunks no longer means more deadlock risk. Cap stays 8 (pool
    // max is 40 connections - see database/connection.ts - so headroom is not the constraint).
    const raw = parseInt(process.env.SAP_IMPORT_PARALLELISM || '6', 10);
    const configured = Number.isFinite(raw) && raw > 0 ? raw : 6;
    return Math.max(1, Math.min(8, configured));
  }

  /**
   * Group rows so every row sharing a PO or contract number lands in the same worker chunk -
   * each chunk then processes its rows sequentially (today's per-row SAVEPOINT logic,
   * unchanged) in its own transaction, concurrently with the other chunks. This is what makes
   * the pg_advisory_xact_lock in SapDataDistributionService.distributeData actually mean
   * "never contends within one import run" instead of "usually doesn't".
   */
  private static partitionRowContextsByContractIdentity(
    rows: RowImportContext[],
    numChunks: number,
  ): RowImportContext[][] {
    if (numChunks <= 1) return rows.length > 0 ? [rows] : [];
    const buckets: RowImportContext[][] = Array.from({ length: numChunks }, () => []);
    const identityToChunk = new Map<string, number>();
    let nextChunk = 0;
    for (const ctx of rows) {
      const identityKey = ctx.contractNumber || ctx.poNumber || `__row_${ctx.rowIndex}`;
      let chunkIdx = identityToChunk.get(identityKey);
      if (chunkIdx === undefined) {
        chunkIdx = nextChunk % numChunks;
        identityToChunk.set(identityKey, chunkIdx);
        nextChunk++;
      }
      buckets[chunkIdx].push(ctx);
    }
    return buckets.filter((b) => b.length > 0);
  }

  /**
   * Process one chunk of rows in its own connection/transaction. Body is the same per-row
   * SAVEPOINT/hash-skip/distribute logic that used to run inline in the single big transaction;
   * only the orchestration around it changed. Never throws - a fatal (non-row) error rolls back
   * just this chunk and is reported as every one of its rows failing, so a connection blip in
   * one worker cannot discard rows already committed by sibling chunks.
   */
  private static async runImportChunk(
    importId: string,
    chunkRows: RowImportContext[],
    rawDataIds: string[],
    existingProcessedMap: Map<string, { id: string; contentHash: string | null }>,
    chunkLabel: string,
    shipmentPrefetchMap: Map<string, { id: string; contractId: string }> = new Map(),
  ): Promise<ChunkImportResult> {
    const chunkResult: ChunkImportResult = {
      processedRecords: 0,
      failedRecords: 0,
      skippedRecords: 0,
      cancelledRecords: 0,
      wasCancelled: false,
      errors: [],
      successIdentities: [],
      failedIdentities: [],
      retryableFailedRows: [],
      unprocessedAfterAbortRows: [],
      summary: emptyChunkSummary(),
    };

    let lastFlushedDone = 0;
    let lastFlushedFailed = 0;
    const flushProgress = async (force = false) => {
      const done = chunkResult.processedRecords + chunkResult.skippedRecords;
      const failed = chunkResult.failedRecords;
      const doneDelta = done - lastFlushedDone;
      const failedDelta = failed - lastFlushedFailed;
      if (!force && doneDelta === 0 && failedDelta === 0) return;
      if (!force && doneDelta < 25 && failedDelta === 0) return;
      lastFlushedDone = done;
      lastFlushedFailed = failed;
      try {
        // Atomic increment: several chunk workers write this same sap_data_imports row
        // concurrently, so SET processed_records = <computed total> would lose sibling updates.
        await pool.query(
          `UPDATE sap_data_imports SET processed_records = processed_records + $1, failed_records = failed_records + $2 WHERE id = $3`,
          [doneDelta, failedDelta, importId],
        );
      } catch (progressErr) {
        logger.error('Failed to flush SAP import progress for chunk', { importId, chunkLabel, progressErr });
      }
    };

    // Batched quality-survey inserts for this chunk (see SapDataDistributionService.
    // flushQualitySurveyQueue): entries queued by rows that succeed are flushed as one multi-row
    // INSERT before COMMIT below; entries queued by a row that itself fails are discarded (see
    // the catch block's qualitySurveyQueue.length truncation) so a rolled-back row never leaves
    // an orphaned survey behind.
    const qualitySurveyQueue: Array<{ shipmentId: string; qualityData: any }> = [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (let rowPos = 0; rowPos < chunkRows.length; rowPos++) {
        // Cheap in-memory check (no DB round trip) between rows, so a cancel request takes
        // effect within one row of being issued instead of only at the next chunk boundary.
        // Rows already released past their SAVEPOINT stay committed below; everything from
        // here on is left untouched and reported as cancelled, not failed.
        if (this.isCancelRequested(importId)) {
          chunkResult.wasCancelled = true;
          chunkResult.cancelledRecords = chunkRows.length - rowPos;
          break;
        }

        const ctx = chunkRows[rowPos];
        const i = ctx.rowIndex;
        const savepointName = `sp_mv2_${chunkLabel}_${i}`;
        const rawDataId = rawDataIds[i];
        const failurePo = ctx.poNumber;
        const failureSto = ctx.stoKey || null;
        const rowIdentity = ctx.rowIdentity;

        const qualityQueueStart = qualitySurveyQueue.length;
        try {
          await client.query(`SAVEPOINT ${savepointName}`);
          const { parsedData, poNumber, stoKey, contentHash } = ctx;

          if (!poNumber) {
            throw new Error('Row skipped: PO number is required');
          }

          const existing = existingProcessedMap.get(this.processedDataKey(poNumber, stoKey));

          if (existing) {
            const unchanged = !!contentHash && !!existing.contentHash && contentHash === existing.contentHash;

            if (unchanged) {
              // Hash-skip: byte-identical to what's already stored for this PO+STO, so skip the
              // full data rewrite AND distributeToTables (the 20-60+ query fan-out) entirely.
              // Bookkeeping columns still get touched so absence/presence tracking sees this row
              // as "seen" this import.
              await client.query(
                `UPDATE sap_processed_data
                   SET import_id = $1, raw_data_id = $2, last_seen_at = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [importId, rawDataId, existing.id],
              );
              await client.query(`UPDATE sap_raw_data SET status = 'skipped' WHERE id = $1`, [rawDataId]);
              await client.query(`RELEASE SAVEPOINT ${savepointName}`);
              chunkResult.skippedRecords++;
              if (rowIdentity) chunkResult.successIdentities.push(rowIdentity);
              await flushProgress();
              continue;
            }

            // Changed row: identical to the pre-optimization full update + distribute path.
            const supplierName = parsedData.contract?.supplier || null;
            const product = parsedData.contract?.product || null;
            const vesselName = parsedData.vessel?.vessel_name || parsedData.shipment?.vessel || null;
            const incoterm = parsedData.contract?.incoterm || null;
            const transportMode = parsedData.contract?.sea_land || parsedData.contract?.transport_mode || null;
            const shipmentId = parsedData.shipment?.shipment_id || parsedData.shipment?.id || stoKey || null;

            await client.query(
              `UPDATE sap_processed_data
                 SET data = $1,
                     import_id = $2,
                     raw_data_id = $3,
                     contract_number = $4,
                     shipment_id = $5,
                     po_number = $6,
                     sto_number = $7,
                     supplier_name = $8,
                     product = $9,
                     vessel_name = $10,
                     incoterm = $11,
                     transport_mode = $12,
                     content_hash = $13,
                     last_seen_at = CURRENT_TIMESTAMP
               WHERE id = $14`,
              [
                JSON.stringify(parsedData),
                importId,
                rawDataId,
                ctx.contractNumber,
                shipmentId,
                poNumber,
                stoKey || null,
                supplierName,
                product,
                vesselName,
                incoterm,
                transportMode,
                contentHash,
                existing.id,
              ],
            );

            const distributionResult = await this.distributeToTables(client, parsedData, shipmentPrefetchMap, qualitySurveyQueue);
            chunkResult.summary.contractsCreated += distributionResult.contractCreated ? 1 : 0;
            chunkResult.summary.shipmentsCreated += distributionResult.shipmentCreated ? 1 : 0;
            chunkResult.summary.qualitySurveysCreated += distributionResult.qualitySurveysCreated;
            chunkResult.summary.truckingOperationsCreated += distributionResult.truckingOperationsCreated;
            chunkResult.summary.paymentsCreated += distributionResult.paymentCreated ? 1 : 0;

            await client.query('UPDATE sap_raw_data SET status = $1 WHERE id = $2', ['processed', rawDataId]);
            await client.query(`RELEASE SAVEPOINT ${savepointName}`);

            chunkResult.processedRecords++;
            if (rowIdentity) chunkResult.successIdentities.push(rowIdentity);
            await flushProgress();
            continue;
          }

          // New PO+STO: store + distribute (same as before), now also persisting content_hash.
          const newSpdId = await this.storeProcessedData(client, importId, rawDataId, parsedData, contentHash);

          // existingProcessedMap is a point-in-time snapshot taken before any row in this run was
          // processed, so it has no way to know about a row this same run just inserted. Without
          // this update, a second Excel row sharing this exact PO+STO (a split/multi-line STO -
          // common in the source data) would also see "not existing" here, also try to INSERT, and
          // crash on the sap_processed_po_sto_uidx unique index - discarding that row's data
          // entirely instead of updating the row just created. Rows sharing a PO+STO always land in
          // the same chunk (see partitionRowContextsByContractIdentity), so mutating this shared map
          // here is safe - no other concurrently-running chunk can hold the same key.
          existingProcessedMap.set(this.processedDataKey(poNumber, stoKey), {
            id: newSpdId,
            contentHash,
          });

          const distributionResult = await this.distributeToTables(client, parsedData, shipmentPrefetchMap, qualitySurveyQueue);
          chunkResult.summary.contractsCreated += distributionResult.contractCreated ? 1 : 0;
          chunkResult.summary.shipmentsCreated += distributionResult.shipmentCreated ? 1 : 0;
          chunkResult.summary.qualitySurveysCreated += distributionResult.qualitySurveysCreated;
          chunkResult.summary.truckingOperationsCreated += distributionResult.truckingOperationsCreated;
          chunkResult.summary.paymentsCreated += distributionResult.paymentCreated ? 1 : 0;

          await client.query('UPDATE sap_raw_data SET status = $1 WHERE id = $2', ['processed', rawDataId]);
          await client.query(`RELEASE SAVEPOINT ${savepointName}`);

          chunkResult.processedRecords++;
          if (rowIdentity) chunkResult.successIdentities.push(rowIdentity);
          await flushProgress();
        } catch (error) {
          // This row's SAVEPOINT is being rolled back below - any quality-survey entries it
          // queued (added before the failure) must not survive to the chunk-end flush.
          qualitySurveyQueue.length = qualityQueueStart;
          let savepointRecovered = false;
          try {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            await client.query(`RELEASE SAVEPOINT ${savepointName}`);
            savepointRecovered = true;
          } catch (spErr) {
            logger.error('Failed to rollback to savepoint', { rowNumber: i + 1, error: spErr });
          }

          chunkResult.failedRecords++;
          const errObj: any = error as any;
          const rawMessage = [
            error instanceof Error ? error.message : 'Unknown error',
            errObj?.detail,
          ]
            .filter((part) => typeof part === 'string' && part.trim().length > 0)
            .join(' - ');
          const errorMsg = formatSapImportRowError({
            poNumber: failurePo ?? rowIdentity?.poNumber ?? null,
            contractNumber: ctx.contractNumber ?? rowIdentity?.contractNumber ?? null,
            stoNumber: failureSto ?? rowIdentity?.stoNumber ?? null,
            rawMessage,
          });
          chunkResult.errors.push(errorMsg);
          if (isFollowOnAbortedTransactionError(rawMessage) || isRetryableFollowOnImportError(errorMsg)) {
            chunkResult.retryableFailedRows.push(ctx);
          }
          logger.error('Failed to process row', { rowNumber: i + 1, error });

          const failedIdentity: SapAutoImportIdentityRow = {
            contractDate: rowIdentity?.contractDate ?? null,
            contractNumber: ctx.contractNumber ?? rowIdentity?.contractNumber ?? null,
            contractExtNo: rowIdentity?.contractExtNo ?? null,
            poNumber: failurePo ?? rowIdentity?.poNumber ?? null,
            stoNumber: failureSto ?? rowIdentity?.stoNumber ?? null,
            supplier: rowIdentity?.supplier ?? null,
            remarks: errorMsg,
          };

          // Isolated connection: bookkeeping must not abort the chunk transaction.
          // Writing these on `client` after a failed row was the source of
          // "current transaction is aborted" follow-on errors for later rows.
          if (rawDataId) {
            try {
              await pool.query(
                `UPDATE sap_raw_data SET status = 'failed', error_message = $1 WHERE id = $2`,
                [errorMsg, rawDataId],
              );
            } catch (updateErr) {
              logger.error('Failed to record row error to sap_raw_data', { rawDataId, updateErr });
            }
          }

          try {
            chunkResult.failedIdentities.push(failedIdentity);
            await pool.query(
              `INSERT INTO sap_import_failures (
                 import_id, row_number, po_number, sto_number, error_message,
                 contract_date, contract_number, contract_ext_no, supplier
               )
               VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                importId,
                i + 1,
                failedIdentity.poNumber,
                failedIdentity.stoNumber,
                errorMsg,
                failedIdentity.contractDate,
                failedIdentity.contractNumber,
                failedIdentity.contractExtNo,
                failedIdentity.supplier,
              ],
            );
          } catch (failLogErr) {
            logger.error('Failed to record row error to sap_import_failures', {
              rowNumber: i + 1,
              failLogErr,
            });
          }

          if (!savepointRecovered) {
            // Chunk TX is likely aborted; do not keep issuing queries on it.
            for (let rest = rowPos + 1; rest < chunkRows.length; rest++) {
              chunkResult.unprocessedAfterAbortRows.push(chunkRows[rest]);
            }
            break;
          }
          await flushProgress();
        }
      }

      if (qualitySurveyQueue.length > 0) {
        await SapDataDistributionService.flushQualitySurveyQueue(client, qualitySurveyQueue);
      }

      await client.query('COMMIT');
      await flushProgress(true);
    } catch (fatalError) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection may already be dead
      }
      const message = fatalError instanceof Error ? fatalError.message : 'Unknown error';
      logger.error('SAP import chunk failed unexpectedly - chunk transaction rolled back', {
        importId,
        chunkLabel,
        fatalError,
      });
      // The whole chunk transaction (including every per-row SAVEPOINT release inside it) is
      // gone, so every row in this chunk is failed - not just the one row that triggered this.
      chunkResult.processedRecords = 0;
      chunkResult.skippedRecords = 0;
      chunkResult.failedRecords = chunkRows.length;
      chunkResult.successIdentities = [];
      chunkResult.summary = emptyChunkSummary();
      chunkResult.retryableFailedRows = [...chunkRows];
      chunkResult.unprocessedAfterAbortRows = [];
      chunkResult.errors = chunkRows.map((ctx) =>
        formatSapImportRowError({
          poNumber: ctx.poNumber,
          contractNumber: ctx.contractNumber ?? ctx.rowIdentity?.contractNumber ?? null,
          stoNumber: ctx.stoKey || null,
          rawMessage: `chunk failed - ${message}`,
        }),
      );
      chunkResult.failedIdentities = chunkRows.map((ctx) => ({
        contractDate: ctx.rowIdentity?.contractDate ?? null,
        contractNumber: ctx.contractNumber ?? ctx.rowIdentity?.contractNumber ?? null,
        contractExtNo: ctx.rowIdentity?.contractExtNo ?? null,
        poNumber: ctx.poNumber,
        stoNumber: ctx.stoKey || null,
        supplier: ctx.rowIdentity?.supplier ?? null,
        remarks: formatSapImportRowError({
          poNumber: ctx.poNumber,
          contractNumber: ctx.contractNumber ?? ctx.rowIdentity?.contractNumber ?? null,
          stoNumber: ctx.stoKey || null,
          rawMessage: `chunk failed - ${message}`,
        }),
      }));
    } finally {
      client.release();
    }

    return chunkResult;
  }

  private static async finalizeCancelledBeforeChunks(
    importId: string,
    totalRecords: number,
  ): Promise<SapMasterV2ImportResult> {
    const finalClient = await pool.connect();
    try {
      await finalClient.query('BEGIN');
      await finalClient.query(
        `UPDATE sap_raw_data
            SET status = 'cancelled',
                error_message = COALESCE(error_message, 'Import cancelled by user')
          WHERE import_id = $1::uuid AND status = 'pending'`,
        [importId],
      );
      await finalClient.query(
        `UPDATE sap_data_imports
            SET status = 'cancelled',
                error_log = COALESCE(error_log, $1)
          WHERE id = $2`,
        [JSON.stringify(['Import cancelled by user before row processing started.']), importId],
      );
      await finalClient.query('COMMIT');
    } catch (earlyCancelErr) {
      await finalClient.query('ROLLBACK');
      throw earlyCancelErr;
    } finally {
      finalClient.release();
      this.clearCancelRequest(importId);
    }
    logger.info('SAP MASTER v2 import cancelled before chunk processing', { importId });
    return {
      success: false,
      importId,
      totalRecords,
      processedRecords: 0,
      failedRecords: 0,
      skippedRecords: 0,
      cancelled: true,
      errors: ['Import cancelled by user before row processing started.'],
    };
  }

  private static async processMasterV2Import(
    importId: string,
    validDataRows: any[][],
    fieldMetadata: FieldMetadata[]
  ): Promise<SapMasterV2ImportResult> {
    try {
      logger.info('Processing SAP MASTER v2 import rows', { importId, totalRows: validDataRows.length });

      if (this.isCancelRequested(importId)) {
        return this.finalizeCancelledBeforeChunks(importId, validDataRows.length);
      }

      // Pure, in-memory parsing (no DB) up front, so the batch prefetch/bulk insert below run
      // before any per-row work starts instead of interleaved with it.
      const rowContexts = this.buildRowContexts(validDataRows, fieldMetadata, importId);
      if (this.isCancelRequested(importId)) {
        return this.finalizeCancelledBeforeChunks(importId, validDataRows.length);
      }

      const [existingProcessedMap, shipmentPrefetchMap, rawDataIds] = await Promise.all([
        this.prefetchExistingProcessedData(rowContexts, importId),
        this.prefetchExistingShipmentsByPoAndSapId(rowContexts, importId),
        this.bulkInsertRawData(importId, rowContexts),
      ]);

      if (this.isCancelRequested(importId)) {
        return this.finalizeCancelledBeforeChunks(importId, validDataRows.length);
      }

      const numChunks = this.resolveImportParallelism(rowContexts.length);
      const chunks = this.partitionRowContextsByContractIdentity(rowContexts, numChunks);

      logger.info('SAP MASTER v2 import chunk plan', {
        importId,
        totalRows: rowContexts.length,
        chunkCount: chunks.length,
        chunkSizes: chunks.map((c) => c.length),
      });

      const chunkResults = await Promise.all(
        chunks.map((chunkRows, idx) =>
          this.runImportChunk(importId, chunkRows, rawDataIds, existingProcessedMap, String(idx), shipmentPrefetchMap),
        ),
      );

      const aggregate = chunkResults.reduce<ChunkImportResult>(
        (acc, r) => ({
          processedRecords: acc.processedRecords + r.processedRecords,
          failedRecords: acc.failedRecords + r.failedRecords,
          skippedRecords: acc.skippedRecords + r.skippedRecords,
          cancelledRecords: acc.cancelledRecords + r.cancelledRecords,
          wasCancelled: acc.wasCancelled || r.wasCancelled,
          errors: acc.errors.concat(r.errors),
          successIdentities: acc.successIdentities.concat(r.successIdentities),
          failedIdentities: acc.failedIdentities.concat(r.failedIdentities),
          retryableFailedRows: acc.retryableFailedRows.concat(r.retryableFailedRows),
          unprocessedAfterAbortRows: acc.unprocessedAfterAbortRows.concat(r.unprocessedAfterAbortRows),
          summary: {
            contractsCreated: acc.summary.contractsCreated + r.summary.contractsCreated,
            shipmentsCreated: acc.summary.shipmentsCreated + r.summary.shipmentsCreated,
            qualitySurveysCreated: acc.summary.qualitySurveysCreated + r.summary.qualitySurveysCreated,
            truckingOperationsCreated: acc.summary.truckingOperationsCreated + r.summary.truckingOperationsCreated,
            paymentsCreated: acc.summary.paymentsCreated + r.summary.paymentsCreated,
          },
        }),
        {
          processedRecords: 0,
          failedRecords: 0,
          skippedRecords: 0,
          cancelledRecords: 0,
          wasCancelled: false,
          errors: [],
          successIdentities: [],
          failedIdentities: [],
          retryableFailedRows: [],
          unprocessedAfterAbortRows: [],
          summary: emptyChunkSummary(),
        },
      );

      let {
        processedRecords,
        failedRecords,
        skippedRecords,
        cancelledRecords,
        wasCancelled,
        errors,
        successIdentities,
        failedIdentities,
        summary,
      } = aggregate;
      let importWasCancelled = wasCancelled || this.isCancelRequested(importId);

      const retryRows = importWasCancelled
        ? []
        : dedupeImportRetryRows([
            ...aggregate.retryableFailedRows,
            ...aggregate.unprocessedAfterAbortRows,
          ]);
      if (retryRows.length > 0) {
        logger.info('Retrying follow-on aborted SAP import rows in isolated transactions', {
          importId,
          retryCount: retryRows.length,
        });
        const retryFailedIndexSet = new Set(aggregate.retryableFailedRows.map((row) => row.rowIndex));
        let retriedFollowOnCount = 0;
        let retryProcessed = 0;
        let retrySkipped = 0;
        let retryFailed = 0;
        const retryErrors: string[] = [];
        const retrySuccessIdentities: SapAutoImportIdentityRow[] = [];
        const retryFailedIdentities: SapAutoImportIdentityRow[] = [];
        const retrySummary = emptyChunkSummary();

        for (const ctx of retryRows) {
          if (this.isCancelRequested(importId)) {
            break;
          }
          if (retryFailedIndexSet.has(ctx.rowIndex)) {
            try {
              await pool.query(
                `DELETE FROM sap_import_failures
                  WHERE import_id = $1::uuid AND row_number = $2`,
                [importId, ctx.rowIndex + 1],
              );
            } catch (cleanupErr) {
              logger.error('Failed to clear prior sap_import_failures before retry', {
                importId,
                rowNumber: ctx.rowIndex + 1,
                cleanupErr,
              });
            }
          }
          const retryResult = await this.runImportChunk(
            importId,
            [ctx],
            rawDataIds,
            existingProcessedMap,
            `retry_${ctx.rowIndex}`,
            shipmentPrefetchMap,
          );
          if (retryFailedIndexSet.has(ctx.rowIndex)) {
            retriedFollowOnCount += 1;
          }
          retryProcessed += retryResult.processedRecords;
          retrySkipped += retryResult.skippedRecords;
          retryFailed += retryResult.failedRecords;
          retryErrors.push(...retryResult.errors);
          retrySuccessIdentities.push(...retryResult.successIdentities);
          retryFailedIdentities.push(...retryResult.failedIdentities);
          retrySummary.contractsCreated += retryResult.summary.contractsCreated;
          retrySummary.shipmentsCreated += retryResult.summary.shipmentsCreated;
          retrySummary.qualitySurveysCreated += retryResult.summary.qualitySurveysCreated;
          retrySummary.truckingOperationsCreated += retryResult.summary.truckingOperationsCreated;
          retrySummary.paymentsCreated += retryResult.summary.paymentsCreated;

          if (retryResult.processedRecords + retryResult.skippedRecords > 0) {
            try {
              await pool.query(
                `DELETE FROM sap_import_failures
                  WHERE import_id = $1::uuid AND row_number = $2`,
                [importId, ctx.rowIndex + 1],
              );
            } catch (cleanupErr) {
              logger.error('Failed to clear sap_import_failures after successful retry', {
                importId,
                rowNumber: ctx.rowIndex + 1,
                cleanupErr,
              });
            }
          }
        }

        const merged = mergeFollowOnRetryCounts({
          originalProcessed: processedRecords,
          originalSkipped: skippedRecords,
          originalFailed: failedRecords,
          retriedFollowOnCount,
          retryProcessed,
          retrySkipped,
          retryFailed,
        });
        processedRecords = merged.processedRecords;
        skippedRecords = merged.skippedRecords;
        failedRecords = merged.failedRecords;
        errors = errors.filter((msg) => !isRetryableFollowOnImportError(msg)).concat(retryErrors);
        successIdentities = successIdentities.concat(retrySuccessIdentities);
        failedIdentities = failedIdentities
          .filter((row) => !isRetryableFollowOnImportError(row.remarks || ''))
          .concat(retryFailedIdentities);
        summary = {
          contractsCreated: summary.contractsCreated + retrySummary.contractsCreated,
          shipmentsCreated: summary.shipmentsCreated + retrySummary.shipmentsCreated,
          qualitySurveysCreated: summary.qualitySurveysCreated + retrySummary.qualitySurveysCreated,
          truckingOperationsCreated:
            summary.truckingOperationsCreated + retrySummary.truckingOperationsCreated,
          paymentsCreated: summary.paymentsCreated + retrySummary.paymentsCreated,
        };
      }

      importWasCancelled = importWasCancelled || this.isCancelRequested(importId);

      // Final bookkeeping pass, once, after every chunk has committed (or rolled back) its own
      // transaction - same status-update + absence/presence logic as before (7/7b below), just
      // no longer sharing a single connection with the per-row work.
      const finalClient = await pool.connect();
      try {
        await finalClient.query('BEGIN');

        // 7. Update import status
        if (importWasCancelled) {
          // Remaining sap_raw_data rows were inserted as pending before chunking; mark them so
          // history does not look hung. Do not treat them as failed — the user asked to stop.
          await finalClient.query(
            `UPDATE sap_raw_data
                SET status = 'cancelled',
                    error_message = COALESCE(error_message, 'Import cancelled by user')
              WHERE import_id = $1::uuid AND status = 'pending'`,
            [importId],
          );
        }
        const cancelNote = importWasCancelled
          ? `Import cancelled by user. ${cancelledRecords} remaining row(s) were not processed.`
          : null;
        const finalErrors = importWasCancelled
          ? [cancelNote, ...errors].filter((e): e is string => !!e)
          : errors;
        await finalClient.query(
          `UPDATE sap_data_imports 
           SET status = CASE
                 WHEN $6::boolean OR status = 'cancelled' THEN 'cancelled'
                 ELSE $1
               END,
               processed_records = $2,
               failed_records = $3,
               error_log = $4 
           WHERE id = $5`,
          [
            failedRecords === 0 ? 'completed' : 'completed_with_errors',
            processedRecords + skippedRecords,
            failedRecords,
            finalErrors.length > 0 ? JSON.stringify(finalErrors) : null,
            importId,
            importWasCancelled,
          ]
        );

        // 7b. Snapshot-absence tracking (observe only - changes no total and no list).
        // The SAP Report is a full snapshot: a PO stays while Open and after Close, and drops
        // out only when cancelled/deleted. Absence is therefore meaningful - but only from an
        // import that actually completed. A partly-failed import looks identical to a mass
        // cancellation (2026-07-27: 1,250 failed rows would have withdrawn 585 live POs).
        // A user-cancelled import is also an incomplete snapshot — never withdraw from it.
        try {
          if (!importWasCancelled) {
            const totalRecords = processedRecords + skippedRecords + failedRecords;
            const trusted = await evaluateImportTrust(finalClient, importId, totalRecords, failedRecords);
            if (trusted) {
              await applyAbsenceForImport(finalClient, importId);
              // Phase 2: turn the counters into presence state. Withdraws POs cancelled in SAP,
              // restores any that came back, supersedes stale STO rows. Nothing is deleted.
              await applyPresenceState(finalClient, { importId });
            }
          }
        } catch (absenceErr) {
          // Never let bookkeeping fail an import that already succeeded.
          logger.error('SAP absence tracking failed (import itself is unaffected)', { absenceErr });
        }

        await finalClient.query('COMMIT');
      } catch (finalErr) {
        await finalClient.query('ROLLBACK');
        throw finalErr;
      } finally {
        finalClient.release();
      }

      if (processedRecords > 0) {
        invalidateShipmentsListCache();
        invalidateShippingPerformanceRowCache();
        invalidateTruckingListCache();
        setImmediate(() => {
          import('./contractQtyMoveSnapshot.service')
            .then(({ ContractQtyMoveSnapshotService }) => ContractQtyMoveSnapshotService.refreshAll())
            .catch(() => {});
          import('./contractStoAggSnapshot.service')
            .then(({ ContractStoAggSnapshotService }) => ContractStoAggSnapshotService.refreshAll())
            .catch(() => {});
          import('./contractLatestSpdSnapshot.service')
            .then(({ ContractLatestSpdSnapshotService }) => ContractLatestSpdSnapshotService.refreshAll())
            .catch(() => {});
          import('./b2bEndingChildSnapshot.service')
            .then(({ B2bEndingChildSnapshotService }) => B2bEndingChildSnapshotService.refreshAll())
            .catch(() => {});
          import('./prePlannedGroup.service')
            .then(({ schedulePrePlannedRebuildIfEnabled }) =>
              schedulePrePlannedRebuildIfEnabled('sap-import'),
            )
            .catch(() => {});
        });
      }
      
      logger.info(importWasCancelled ? 'SAP MASTER v2 import cancelled' : 'SAP MASTER v2 import completed', {
        importId,
        processedRecords,
        failedRecords,
        skippedRecords,
        cancelledRecords,
        cancelled: importWasCancelled,
        summary
      });

      this.clearCancelRequest(importId);
      
      return {
        success: !importWasCancelled,
        importId,
        totalRecords: validDataRows.length,
        processedRecords,
        failedRecords,
        skippedRecords,
        cancelled: importWasCancelled,
        errors: errors.length > 0 ? errors.slice(0, 100) : undefined, // Limit to first 100 errors
        successIdentities,
        failedIdentities,
        summary
      };
      
    } catch (error) {
      logger.error('SAP MASTER v2 import failed', { importId, error });
      this.clearCancelRequest(importId);
      await this.markImportFailed(importId, error);
      throw error;
    }
  }
  
  /**
   * Parse field metadata from header rows
   */
  private static parseFieldMetadata(jsonData: any[][], config: MasterV2Config = this.DEFAULT_CONFIG): FieldMetadata[] {
    const metadata: FieldMetadata[] = [];
    
    const legendRow1 = jsonData[config.legendRow1] || [];
    const legendRow2 = jsonData[config.legendRow2] || [];
    const headerRow = jsonData[config.headerRow] || [];
    const sapFieldRow1 = jsonData[config.sapFieldRow1] || [];
    const sapFieldRow2 = jsonData[config.sapFieldRow2] || [];
    
    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i];
      
      const sapSource1 = sapFieldRow1[i] || '';
      const sapSource2 = sapFieldRow2[i] || '';
      const legend1 = legendRow1[i] || '';
      const legend2 = legendRow2[i] || '';
      
      // Determine user role from legend
      const userRole = this.determineUserRole(legend1, legend2);
      
      // Determine if field is from SAP, manual, or calculated
      const isFromSap = this.isFromSapSource(sapSource1, sapSource2);
      const isManualEntry = this.isManualEntryField(sapSource1, sapSource2);
      const isCalculated = this.isCalculatedField(sapSource1, sapSource2);
      
      // Always add metadata for ALL columns to keep indices aligned
      // Even if header is null/empty
      metadata.push({
        columnIndex: i,
        index: i, // Add index property
        headerName: header || `Column_${i}`, // Use placeholder for empty headers
        sapSource1,
        sapSource2,
        userRole,
        isFromSap,
        isManualEntry,
        isCalculated
      });
    }
    
    return metadata;
  }
  
  /**
   * Determine user role from legend rows
   */
  private static determineUserRole(legend1: string, legend2: string): string {
    const combined = `${legend1} ${legend2}`.toLowerCase();
    
    if (combined.includes('trader')) return 'TRADING';
    if (combined.includes('logistics trucking')) return 'LOGISTICS_TRUCKING';
    if (combined.includes('logistics shipping')) return 'LOGISTICS_SHIPPING';
    if (combined.includes('quality')) return 'QUALITY';
    if (combined.includes('finance')) return 'FINANCE';
    if (combined.includes('admin')) return 'ADMIN';
    if (combined.includes('management')) return 'MANAGEMENT';
    if (combined.includes('database')) return 'SYSTEM';
    if (combined === 'all') return 'ALL';
    
    return 'GENERAL';
  }
  
  /**
   * Check if field is from SAP
   */
  private static isFromSapSource(sapSource1: string, sapSource2: string): boolean {
    const combined = `${sapSource1} ${sapSource2}`.toLowerCase();
    return combined.includes('get data') || 
           combined.includes('using') ||
           (combined.length > 0 && 
            !combined.includes('offline') && 
            !combined.includes('formulasi') &&
            !combined.includes('skip'));
  }
  
  /**
   * Check if field requires manual entry
   */
  private static isManualEntryField(sapSource1: string, sapSource2: string): boolean {
    const combined = `${sapSource1} ${sapSource2}`.toLowerCase();
    return combined.includes('offline') || combined.trim() === '';
  }
  
  /**
   * Check if field is calculated
   */
  private static isCalculatedField(sapSource1: string, sapSource2: string): boolean {
    const combined = `${sapSource1} ${sapSource2}`.toLowerCase();
    return combined.includes('formulasi') || combined.includes('formula');
  }
  
  /**
   * Parse a data row into structured object
   */
  private static parseDataRow(row: any[], fieldMetadata: FieldMetadata[]): any {
    const parsed: any = {
      contract: {},
      shipment: {},
      quality: [],
      trucking: [],
      payment: {},
      vessel: {},
      raw: {}
    };
    
    // Create raw object with field names mapped to values
    for (let index = 0; index < row.length; index++) {
      const value = row[index];
      
      if (index >= fieldMetadata.length) continue;
      
      const field = fieldMetadata[index];
      if (!field || !field.headerName) continue;
      
      const fieldName = field.headerName;
      
      // Store in raw object with proper field name
        if (fieldName && fieldName.trim() !== '') {
        parsed.raw[fieldName] = value;
        applySapMasterV2RawFieldAliases(parsed.raw, fieldName, value);

        // Categorize by type - STO should go to shipment first
        const normalizedFieldName = this.normalizeFieldName(fieldName);
        
        if (fieldName.toLowerCase().includes('sto no') || fieldName.toLowerCase().includes('sto number')) {
          parsed.shipment[normalizedFieldName] = value;
        } else if (this.isContractField(fieldName)) {
          parsed.contract[normalizedFieldName] = value;
        } else if (isTruckingQuantityField(fieldName)) {
          this.addTruckingData(parsed.trucking, fieldName, value);
        } else if (this.isVesselDimensionField(fieldName)) {
          // Before isShipmentField: "Vessel LOA" contains "vessel" and would otherwise
          // land in shipment.vessel_loading_port_1 via partial map match.
          parsed.vessel[normalizedFieldName] = value;
        } else if (this.isShipmentField(fieldName)) {
          parsed.shipment[normalizedFieldName] = value;
        } else if (this.isQualityField(fieldName)) {
          this.addQualityData(parsed.quality, fieldName, value);
        } else if (this.isTruckingField(fieldName)) {
          this.addTruckingData(parsed.trucking, fieldName, value);
        } else if (this.isPaymentField(fieldName)) {
          parsed.payment[normalizedFieldName] = value;
        } else if (this.isVesselField(fieldName)) {
          parsed.vessel[normalizedFieldName] = value;
        }
      }
    }
    
    return parsed;
  }
  
  /**
   * Helper functions to categorize fields
   */
  private static isContractField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase();
    const contractFields = [
      'group', 'supplier', 'buyer', 'contract date', 'product', 'contract no', 'po no',
      'incoterm', 'incoterms', // Handle both singular and plural
      'sea / land', 'sea/land', // Handle with and without spaces
      'contract quantity', 'contract qty uom', 'unit price', 'currency unit price', 'due date delivery',
      'source', 'ltc / spot', 'lt/spot', // Handle with and without space
      'status', 'gr po status', 'gr sto status', 'sto no', 'sto quantity', 'sto qty uom', 'classification',
      'delete po status', 'delete sto status',
      'b2b flag', 'contract type', 'contract reff po', 'contract reff po ini', 'contract reff so ini',
      'contract ref po', 'contract ref po initial', 'contract ref so initial',
      'contract ext no', 'company code', 'plant code', 'vendor group',
    ];
    return contractFields.some(cf => lower.includes(cf));
  }
  
  /** LOA / draft / hull — not loading-port fields (see Vessel LOA → vessel_loa). */
  private static isVesselDimensionField(fieldName: string): boolean {
    const lower = fieldName
      .toLowerCase()
      .replace(/\r\n/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (lower.includes('loading') || lower.includes('discharge') || lower.includes('port')) {
      return false;
    }
    return (
      lower === 'loa' ||
      lower === 'vessel loa' ||
      lower === 'draft' ||
      lower === 'vessel draft' ||
      lower === 'hull' ||
      lower === 'vessel hull' ||
      lower === 'vessel hull type' ||
      /(?:^|\s)(loa|draft|hull)(?:\s|$)/.test(lower)
    );
  }

  private static isShipmentField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase();
    if (isTruckingQuantityField(fieldName)) return false;
    if (this.isVesselDimensionField(fieldName)) return false;
    const shipmentFields = [
      'vessel', 'voyage', 'loading port', 'discharge port', 'eta', 'ata',
      'berthed', 'sailed', 'arrival', 'quantity at', 'sto', 'shipment',
      'qty deliver', 'quantity delivery', 'qty receive', 'quantity receive', 'last receive',
      'delivery vessel uom', 'receive uom', 'b/l qty uom',
      'sto item',
      'ship figure', 'sfal', 'sfbd',
      'transit destination', 'discharge destination',
    ];
    return shipmentFields.some(sf => lower.includes(sf));
  }
  
  private static isQualityField(fieldName: string): boolean {
    const qualityFields = ['ffa', 'm&i', 'm & i', 'dobi', 'iv', 'color', 'red', 'd&s', 'd& s', 'stone'];
    return qualityFields.some(qf => fieldName.toLowerCase().includes(qf));
  }
  
  private static isTruckingField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase();
    if (isTruckingQuantityField(fieldName)) return true;
    if (lower.includes('delivery trucking uom') || lower === 'receive uom') return true;
    return lower.includes('truck') ||
           lower.includes('trucking') ||
           lower.includes('cargo readiness') ||
           (lower.includes('qty deliver') && !lower.includes('vessel')) ||
           (lower.includes('qty receive') && !lower.includes('vessel')) ||
           lower.includes('selisih qty');
  }
  
  private static isPaymentField(fieldName: string): boolean {
    return fieldName.toLowerCase().includes('payment') || 
           fieldName.toLowerCase().includes('dp date') ||
           fieldName.toLowerCase().includes('payoff');
  }
  
  private static isVesselField(fieldName: string): boolean {
    const vesselFields = ['vessel', 'voyage', 'charter', 'loa', 'draft', 'hull'];
    return vesselFields.some(vf => fieldName.toLowerCase().includes(vf));
  }
  
  /**
   * Normalize field names for database columns
   */
  private static normalizeFieldName(fieldName: string): string {
    // Clean the field name first: remove line breaks, extra spaces, and special chars
    let cleanFieldName = fieldName
      .replace(/\r\n/g, ' ')  // Replace line breaks with space
      .replace(/\n/g, ' ')     // Replace newlines with space
      .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
      .trim()                  // Trim leading/trailing spaces
      .toLowerCase();
    
    // Comprehensive field mapping with exact Excel column names
    const fieldMapping: { [key: string]: string } = {
      // TRADING FIELDS
      'group': 'group',
      'supplier (vendor -> name 1))': 'supplier',
      'supplier': 'supplier',
      'vendor': 'supplier',
      'name 1': 'supplier',
      'vendor group': 'group',
      
      'contract date (sama dengan po date)': 'contract_date',
      'contract date': 'contract_date',
      'po date': 'contract_date',
      
      'product (material desc)': 'product',
      'product': 'product',
      'material desc': 'product',
      'material': 'product',
      
      // CRITICAL: Contract No and PO No are DIFFERENT fields!
      'contract no. (no contract) ini nomer kontrak auto generate': 'contract_no',
      'contract no.': 'contract_no',
      'contract no': 'contract_no',
      'contract number': 'contract_no',
      'no contract': 'contract_no',
      'contract ext no': 'contract_ext_no',
      'contract ext no.': 'contract_ext_no',
      
      'po no.': 'po_no',
      'po no': 'po_no',
      'po number': 'po_no',
      
      // NEW: Buyer field (Column F)
      'buyer': 'buyer',
      
      // UPDATED: B2B Flag → Contract Type (Column J)
      'b2b flag': 'contract_type',
      'contract type': 'contract_type',
      
      // UPDATED: CONTRACT REFF PO → Contract Reff PO Ini (Column K)
      'contract reff po': 'contract_reference_po',
      'contract reff po ini': 'contract_reference_po',
      'contract ref po': 'contract_reference_po',
      
      // NEW: Contract Reff SO Ini (Column L)
      'contract reff so ini': 'contract_reference_so',
      'contract ref so ini': 'contract_reference_so',
      'contract reff so': 'contract_reference_so',
      
      'company code': 'company_code',
      'company code.': 'company_code',

      'plant code': 'plant_code',
      'plant code.': 'plant_code',
      
      'incoterm at starting point 1': 'incoterm_starting_1',
      'incoterm at starting point 2': 'incoterm_starting_2',
      'incoterm at starting point 3': 'incoterm_starting_3',
      'incoterm at loading port 2': 'incoterm_loading_2',
      'incoterm': 'incoterm',
      'incoterms': 'incoterm', // Handle plural form
      
      'sea / land': 'sea_land',
      'sea/land': 'sea_land', // Handle without spaces
      'transport': 'sea_land',
      
      'contract quantity (or po qty)': 'contract_quantity',
      'contract quantity': 'contract_quantity',
      'po qty': 'contract_quantity',
      'contract qty uom': 'contract_qty_uom',
      
      'unit price': 'unit_price',
      'price': 'unit_price',
      'currency unit price': 'currency_unit_price',
      
      'due date delivery (start)': 'due_date_delivery_start',
      'due date delivery (end)': 'due_date_delivery_end',
      'due date delivery': 'due_date_delivery_start',
      
      'source (3rd party/inhouse)': 'source',
      'source': 'source',
      '3rd party': 'source',
      'inhouse': 'source',
      
      'ltc / spot': 'ltc_spot',
      'lt/spot': 'ltc_spot', // Handle without space
      'ltc': 'ltc_spot',
      'spot': 'ltc_spot',
      
      'status': 'status',
      'delete po status': 'delete_po_status',
      'delete sto status': 'delete_sto_status',
      
      // LOGISTICS FIELDS
      'sto no.': 'sto_no',
      'sto no': 'sto_no',
      'sto number': 'sto_no',
      'sto type': 'sto_type',
      
      // NEW: STO Item (Column W)
      'sto item': 'sto_item',
      
      'sto quantity': 'sto_quantity',
      'sto qty uom': 'sto_qty_uom',
      
      'logistics area classification': 'logistics_area_classification',
      // UPDATED: PO Classification → STO Classification (Column Z)
      'po classification': 'sto_classification',
      'sto classification': 'sto_classification',
      
      // FINANCE FIELDS
      'due date payment': 'due_date_payment',
      'dp date': 'dp_date',
      'payoff date': 'payoff_date',
      'payment date deviation (days)': 'payment_date_deviation_days',
      // UPDATED: Simplified field names and new positions
      'dp date deviation (days) dp date - due date': 'dp_date_deviation_days',
      'dp date - due date': 'dp_date_deviation_days', // New position (Column AF)
      'payoff date deviation (days) payoff date - due date': 'payoff_date_deviation_days',
      'payoff date - due date': 'payoff_date_deviation_days', // New position (Column AG)
      
      // TRUCKING FIELDS
      'cargo readiness at starting location': 'cargo_readiness_at_starting_location',
      'cargo readiness at starting location 2': 'cargo_readiness_at_starting_location_2',
      'cargo readiness at starting location 3': 'cargo_readiness_at_starting_location_3',
      'cargo readiness at loading port 1': 'cargo_readiness_at_loading_port_1',
      'cargo readiness at loading port 2': 'cargo_readiness_at_loading_port_2',
      'cargo readiness at loading port 3': 'cargo_readiness_at_loading_port_3',
      
      'truck loading at starting location': 'truck_loading_at_starting_location',
      'truck loading at starting location 2': 'truck_loading_at_starting_location_2',
      'truck loading at starting location 3': 'truck_loading_at_starting_location_3',
      'truck loading at discharge location': 'truck_loading_at_discharge_location',
      
      'truck unloading at starting location': 'truck_unloading_at_starting_location',
      'truck unloading at starting location 2': 'truck_unloading_at_starting_location_2',
      'truck unloading at starting location 3': 'truck_unloading_at_starting_location_3',
      'truck unloading at discharge location': 'truck_unloading_at_discharge_location',
      // UPDATED: Column positions changed (AH, AI, AJ, AK, AL, AM)
      'truck loading location': 'truck_loading_at_starting_location', // Column AH
      'truck discharge location': 'truck_unloading_at_starting_location', // Column AI
      
      'trucking owner at starting location': 'trucking_owner_at_starting_location',
      'trucking owner at starting location 2': 'trucking_owner_at_starting_location_2',
      'trucking owner at starting location 3': 'trucking_owner_at_starting_location_3',
      'truck owner at discharge': 'truck_owner_at_discharge',
      'truck transporter': 'trucking_owner_at_starting_location', // Column AJ
      
      'trucking oa budget at starting location': 'trucking_oa_budget_at_starting_location',
      'trucking oa budget at starting location 2': 'trucking_oa_budget_at_starting_location_2',
      'trucking oa budget at starting location 3': 'trucking_oa_budget_at_starting_location_3',
      'trucking oa budget at discharge': 'trucking_oa_budget_at_discharge',
      'truck oa budget': 'trucking_oa_budget_at_starting_location', // Column AL
      'trucking oa budget': 'trucking_oa_budget_at_starting_location', // Column AL
      'currency trucking oa budget': 'currency_trucking_oa_budget',
      'estimated km': 'estimated_km', // Column AM
      'esimated km': 'estimated_km',
      
      'trucking oa actual at starting location': 'trucking_oa_actual_at_starting_location',
      'trucking oa actual at starting location 2': 'trucking_oa_actual_at_starting_location_2',
      'trucking oa actual at starting location 3': 'trucking_oa_actual_at_starting_location_3',
      'trucking oa actual at discharge': 'trucking_oa_actual_at_discharge',
      'trucking oa actual': 'trucking_oa_actual_at_starting_location', // Column AK
      'currency trucking oa actual': 'currency_trucking_oa_actual',
      
      'quantity sent via trucking (based on surat jalan)': 'quantity_sent_via_trucking_based_on_surat_jalan',
      'quantity delivered via trucking': 'quantity_delivered_via_trucking',
      'selisih': 'trucking_gain_loss',
      'trucking gain/loss at starting location': 'trucking_gain_loss_at_starting_location',
      // UPDATED: QTY DELIVER → Quantity Delivery (Column AD)
      'qty deliver': 'quantity_delivery',
      'quantity delivery': 'quantity_delivery',
      'delivery vessel uom': 'quantity_delivery_uom',
      'delivery trucking uom': 'quantity_delivery_trucking_uom',
      'receive uom': 'quantity_receive_uom',
      'b/l qty uom': 'bl_quantity_uom',
      'qty receive': 'quantity_delivered_via_trucking',
      'selisih qty receive vs qty deliver': 'trucking_gain_loss_at_starting_location',
      
      'trucking starting date at starting location': 'trucking_starting_date_at_starting_location',
      'trucking starting date at starting location 2': 'trucking_starting_date_at_starting_location_2',
      'trucking starting date at starting location 3': 'trucking_starting_date_at_starting_location_3',
      // UPDATED: Trucking Load Port Start Date → Trucking Start Receive Date (Column AV)
      'trucking load port start date': 'trucking_start_receive_date',
      'trucking start receive date': 'trucking_start_receive_date', // Column AV
      
      'trucking completion date at starting location': 'trucking_completion_date_at_starting_location',
      'trucking completion date at starting location 2': 'trucking_completion_date_at_starting_location_2',
      'trucking completion date at starting location 3': 'trucking_completion_date_at_starting_location_3',
      // UPDATED: Trucking Load Port End Date → Trucking Last Receive Date (Column AW)
      'trucking load port end date': 'trucking_last_receive_date',
      'trucking last receive date': 'trucking_last_receive_date', // Column AW
      'last receive date': 'last_receive_date',
      
      // SHIPPING/VESSEL FIELDS
      'loading method (pipeline / trucking)': 'loading_method',
      // UPDATED: Column positions changed (AN, AO, AP, AQ, AR, AS, AT, AU)
      'vessel loading port': 'vessel_loading_port_1',
      'vessel loading port 1': 'vessel_loading_port_1', // Column AN
      'vessel loading port 2': 'vessel_loading_port_2',
      'vessel loading port 3': 'vessel_loading_port_3',
      'vessel discharge port': 'vessel_discharge_port', // Column AO
      'discharge method (pipeline / trucking)': 'discharge_method',
      
      'voyage no.': 'voyage_no',
      // UPDATED: Vessel fields moved (AP, AQ, AR, AS, AT, AU)
      'vessel name': 'vessel_name', // Column AP
      'vessel company': 'vessel_owner', // Column AQ
      'vessel owner': 'vessel_owner',
      'vessel oa actual': 'vessel_oa_actual', // Column AR
      'vessel oa actual ': 'vessel_oa_actual',
      'vessel oa budget': 'vessel_oa_budget', // Column AS
      'vessell oa budget': 'vessel_oa_budget',
      'estimated nm': 'estimated_nautical_miles', // Column AT
      'estimated nautical miles': 'estimated_nautical_miles',
      'vessel code': 'vessel_code', // Column AU
      // Vessel physical properties moved later (BT-BX)
      'vessel draft': 'vessel_draft',
      'loa': 'vessel_loa',
      'vessel loa': 'vessel_loa',
      'vessel capacity': 'vessel_capacity',
      'vessel cappacity': 'vessel_capacity', // Typo handling
      'vessel hull type': 'vessel_hull_type',
      'vessel registration year': 'vessel_registration_year',
      'charter type (vc / tc / mix)': 'charter_type',
      'average vessel speed': 'average_vessel_speed', // Column BY
      
      // QUANTITY FIELDS
      'quantity at loading port 1 (based on bast)': 'quantity_at_loading_port_1_based_on_bast',
      'quantity at loading port 2': 'quantity_at_loading_port_2',
      'quantity at loading port 3': 'quantity_at_loading_port_3',
      'quantity at starting location 2': 'quantity_at_starting_location_2',
      'quantity at starting location 3': 'quantity_at_starting_location_3',
      'actual quantity (at final location)': 'actual_quantity_at_final_location',
      // UPDATED: B/L Quantity moved to Column BG
      'b/l quantity': 'bl_quantity', // Column BG
      'b/l quantity ': 'bl_quantity',
      'actual vessel qty receive': 'actual_vessel_qty_receive',
      'difference final qty - bl qty': 'difference_final_qty_vs_bl_qty',
      'difference  final qty - bl qty ': 'difference_final_qty_vs_bl_qty',
      'ship figure after loading (sfal)': 'sfal',
      'ship figure before discharge (sfbd)': 'sfbd',
      
      // ETA/ATA FIELDS - Loading Port 1
      'eta vessel arrival loading port 1': 'eta_vessel_arrival_loading_port_1',
      // UPDATED: ATA fields moved (AX, AY, AZ, BA, BB)
      'ata vessel arrival at loading port': 'ata_vessel_arrival_at_loading_port_1', // Column AX
      'ata vessel arrival at loading port 1': 'ata_vessel_arrival_at_loading_port_1',
      'ata vessel berthed at loading port': 'ata_vessel_berthed_at_loading_port_1', // Column AY
      'ata vessel berthed at loading port 1': 'ata_vessel_berthed_at_loading_port_1',
      'eta loading start at loading port 1': 'eta_loading_start_at_loading_port_1',
      'ata vessel start loading': 'ata_vessel_start_loading', // Column AZ
      'ata loading start at loading port 1': 'ata_vessel_start_loading',
      'eta loading completed at loading port 1': 'eta_loading_completed_at_loading_port_1',
      'ata vessel completed loading': 'ata_vessel_completed_loading', // Column BA
      'ata loading completed at loading port 1': 'ata_vessel_completed_loading',
      'eta vessel sailed at loading port 1': 'eta_vessel_sailed_at_loading_port_1',
      'ata vessel sailed from loading port': 'ata_vessel_sailed_from_loading_port', // Column BB
      'ata vessel sailed at loading port 1': 'ata_vessel_sailed_from_loading_port',
      'loading rate at loading port 1': 'loading_rate_at_loading_port_1',
      
      // ETA/ATA FIELDS - Loading Port 2
      'eta vessel arrival at loading port 2': 'eta_vessel_arrival_at_loading_port_2',
      'ata vessel arrival at loading port 2': 'ata_vessel_arrival_at_loading_port_2',
      'eta vessel berthed at loading port 2': 'eta_vessel_berthed_at_loading_port_2',
      'ata vessel berthed at loading port 2': 'ata_vessel_berthed_at_loading_port_2',
      'eta loading start at loading port 2': 'eta_loading_start_at_loading_port_2',
      'ata loading start at loading port 2': 'ata_loading_start_at_loading_port_2',
      'eta loading completed at loading port 2': 'eta_loading_completed_at_loading_port_2',
      'ata loading completed at loading port 2': 'ata_loading_completed_at_loading_port_2',
      'eta vessel sailed at loading port 2': 'eta_vessel_sailed_at_loading_port_2',
      'ata vessel sailed at loading port 2': 'ata_vessel_sailed_at_loading_port_2',
      'loading rate at loading port 2': 'loading_rate_at_loading_port_2',
      
      // ETA/ATA FIELDS - Loading Port 3
      'eta vessel arrival at loading port 3': 'eta_vessel_arrival_at_loading_port_3',
      'ata vessel arrival at loading port 3': 'ata_vessel_arrival_at_loading_port_3',
      'eta vessel berthed at loading port 3': 'eta_vessel_berthed_at_loading_port_3',
      'ata vessel berthed at loading port 3': 'ata_vessel_berthed_at_loading_port_3',
      'eta loading start at loading port 3': 'eta_loading_start_at_loading_port_3',
      'ata loading start at loading port 3': 'ata_loading_start_at_loading_port_3',
      'eta loading completed at loading port 3': 'eta_loading_completed_at_loading_port_3',
      'ata loading completed at loading port 3': 'ata_loading_completed_at_loading_port_3',
      'eta vessel sailed at loading port 3': 'eta_vessel_sailed_at_loading_port_3',
      'ata vessel sailed at loading port 3': 'ata_vessel_sailed_at_loading_port_3',
      'loading rate at loading port 3': 'loading_rate_at_loading_port_3',
      
      // ETA/ATA FIELDS - Discharge Port
      'eta arrival at discharge port': 'eta_arrival_at_discharge_port',
      // UPDATED: ATA discharge fields moved (BC, BD, BE, BF)
      'ata vessel arrive at discharge port': 'ata_vessel_arrival_at_discharge_port', // Column BC
      'ata vessel arrival at discharge port': 'ata_vessel_arrival_at_discharge_port',
      'eta vessel berthed at discharge port': 'eta_vessel_berthed_at_discharge_port',
      'ata vessel berthed at discharge port': 'ata_vessel_berthed_at_discharge_port', // Column BD
      'eta discharging start at discharge port': 'eta_discharging_start_at_discharge_port',
      'ata vessel start discharging': 'ata_vessel_start_discharging', // Column BE
      'ata discharging start at discharge port': 'ata_vessel_start_discharging',
      'eta discharging completed at discharge port': 'eta_discharging_completed_at_discharge_port',
      'ata vessel complete discharge': 'ata_vessel_completed_discharge', // Column BF
      'ata discharging completed at discharge port': 'ata_vessel_completed_discharge',
      'discharge rate at discharging port': 'discharge_rate_at_discharging_port',
      
      // QUALITY FIELDS - Updated column positions
      // Loading Loc 1 Quality (Columns BH-BM, moved from BL-BM)
      'quality at loading loc 1 ffa': 'ffa',
      'quality at loading location 1 ffa': 'ffa',
      'quality at loading port 1 ffa': 'ffa',
      'loading loc 1 ffa': 'ffa',
      'quality at loading loc 1 m&i': 'moisture',
      'quality at loading loc 1 m & i': 'moisture',
      'quality at loading location 1 m&i': 'moisture',
      'quality at loading location 1 m & i': 'moisture',
      'quality at loading port 1 m&i': 'moisture',
      'loading loc 1 m&i': 'moisture',
      'quality at loading loc 1 dobi': 'dobi',
      'quality at loading location 1 dobi': 'dobi',
      'quality at loading port 1 dobi': 'dobi',
      'loading loc 1 dobi': 'dobi',
      'quality at loading loc 1 red': 'color_red',
      'quality at loading location 1 red': 'color_red',
      'quality at loading port 1 red': 'color_red',
      'loading loc 1 red': 'color_red',
      'quality at loading loc 1 d&s': 'd_and_s',
      'quality at loading location 1 d&s': 'd_and_s',
      'quality at loading port 1 d&s': 'd_and_s',
      'loading loc 1 d&s': 'd_and_s',
      'quality at loading loc 1 stone': 'stone',
      'quality at loading location 1 stone': 'stone',
      'quality at loading port 1 stone': 'stone',
      'loading loc 1 stone': 'stone',
      
      // Discharge Port Quality (Columns BN-BS, moved from BR-BW)
      'quality at discharge port ffa': 'ffa',
      'discharge port ffa': 'ffa',
      'quality at discharge port m&i': 'moisture',
      'discharge port m&i': 'moisture',
      'quality at discharge port dobi': 'dobi',
      'discharge port dobi': 'dobi',
      'quality at discharge port red': 'color_red',
      'discharge port red': 'color_red',
      'quality at discharge port d&s': 'd_and_s',
      'discharge port d&s': 'd_and_s',
      'quality at discharge port stone': 'stone',
      'discharge port stone': 'stone'
    };
    
    // Check for exact match first
    const mergedMapping = { ...fieldMapping, ...SAP_MASTER_V2_UAT_FIELD_MAPPING };

    if (mergedMapping[cleanFieldName]) {
      return mergedMapping[cleanFieldName];
    }
    
    // Check for partial matches with priority order
    const priorityKeys = [
      'contract no.',
      'po no.',
      'sto no.',
      'contract quantity',
      'sto quantity',
      'vessel name'
    ];
    
    for (const key of priorityKeys) {
      if (cleanFieldName.includes(key)) {
        return mergedMapping[key];
      }
    }
    
    // Check for general partial matches.
    // Guard: "vessel loa" is a substring of "vessel loading port" — do not map LOA → loading port.
    for (const [key, value] of Object.entries(mergedMapping)) {
      if (cleanFieldName.includes(key) || key.includes(cleanFieldName)) {
        if (
          this.isVesselDimensionField(cleanFieldName) &&
          String(value).includes('loading_port')
        ) {
          continue;
        }
        return value;
      }
    }
    
    // Fallback: convert to snake_case
    return cleanFieldName
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }
  
  /**
   * Add quality data (handles multiple locations)
   */
  private static addQualityData(qualityArray: any[], fieldName: string, value: any): void {
    const location = resolveSapMasterV2QualityLocation(fieldName);
    
    // Find or create quality record for this location
    let qualityRecord = qualityArray.find(q => q.location === location);
    if (!qualityRecord) {
      qualityRecord = { location, data: {} };
      qualityArray.push(qualityRecord);
    }
    
    qualityRecord.data[this.normalizeFieldName(fieldName)] = value;
  }
  
  /**
   * Add trucking data (handles multiple locations)
   */
  private static addTruckingData(truckingArray: any[], fieldName: string, value: any): void {
    // Determine sequence from field name
    let sequence = 1;
    if (fieldName.includes('Location 2') || fieldName.includes('Port 2')) {
      sequence = 2;
    } else if (fieldName.includes('Location 3') || fieldName.includes('Port 3')) {
      sequence = 3;
    }
    
    // Find or create trucking record for this sequence
    let truckingRecord = truckingArray.find(t => t.sequence === sequence);
    if (!truckingRecord) {
      truckingRecord = { sequence, data: {} };
      truckingArray.push(truckingRecord);
    }
    
    truckingRecord.data[this.normalizeFieldName(fieldName)] = value;
  }
  
  /**
   * Store processed data in sap_processed_data table
   */
  private static async storeProcessedData(
    client: any,
    importId: string,
    rawDataId: string,
    parsedData: any,
    contentHash: string | null = null,
  ): Promise<string> {
    // Use normalized contract data instead of raw field names
    const contract = parsedData.contract || {};
    const shipment = parsedData.shipment || {};
    const vessel = parsedData.vessel || {};
    
    // Extract values from normalized objects
    const contractNumber = contract.contract_no || null;
    const poNumber = contract.po_no || null;
    const stoNumber = shipment.sto_no || contract.sto_no || null; // STO is in shipment, fallback to contract
    if (!normalizePoNumber(poNumber)) {
      throw new Error('PO number is required for sap_processed_data');
    }
    const shipmentId = shipment.shipment_id || shipment.id || stoNumber || null;
    const supplierName = contract.supplier || null;
    const product = contract.product || null;
    const vesselName = vessel.vessel_name || vessel.name || shipment.vessel || null;
    const incoterm = contract.incoterm || null;
    const transportMode = contract.sea_land || contract.transport_mode || null;

    const inserted = await client.query(
      `INSERT INTO sap_processed_data
       (import_id, raw_data_id, contract_number, shipment_id, po_number, sto_number,
        supplier_name, product, vessel_name, incoterm, transport_mode, data, content_hash, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        importId,
        rawDataId,
        contractNumber,
        shipmentId || stoNumber, // Use STO as shipment ID if no shipment ID
        poNumber,
        stoNumber,
        supplierName,
        product,
        vesselName,
        incoterm,
        transportMode,
        JSON.stringify(parsedData),
        contentHash,
      ]
    );
    return inserted.rows[0].id as string;
  }
  
  /**
   * Distribute data to main tables (contracts, shipments, etc.)
   */
  private static async distributeToTables(
    client: any,
    parsedData: any,
    shipmentPrefetchMap?: Map<string, { id: string; contractId: string }>,
    qualitySurveyQueue?: Array<{ shipmentId: string; qualityData: any }>,
  ): Promise<any> {
    try {
      // Use the distribution service to create/update records
      const distributionResult = await SapDataDistributionService.distributeData(
        client,
        parsedData,
        undefined, // userId - can be passed from import context
        shipmentPrefetchMap,
        qualitySurveyQueue,
      );

      return {
        contractCreated: !!distributionResult.contractId,
        shipmentCreated: !!distributionResult.shipmentId,
        qualitySurveysCreated: distributionResult.qualitySurveyIds.length,
        truckingOperationsCreated: distributionResult.truckingOperationIds.length,
        paymentCreated: !!distributionResult.paymentId,
      };
    } catch (error) {
      // Important: rethrow so the caller can rollback to the row SAVEPOINT.
      // If we swallow the error, Postgres marks the transaction as aborted and subsequent commands fail
      // with "current transaction is aborted...".
      logger.error('Data distribution failed', error);
      throw error;
    }
  }

  /** Parse one SAP MASTER v2 row (for tests and diagnostics). */
  static parseDataRowForTest(row: unknown[], fieldMetadata: FieldMetadata[]): Record<string, unknown> {
    return this.parseDataRow(row as any[], fieldMetadata);
  }

  /** Normalize Excel header → DB key (for tests). */
  static normalizeFieldNameForTest(fieldName: string): string {
    return this.normalizeFieldName(fieldName);
  }

  /** SHA-256 of parsedData (for tests). */
  static computeRowContentHashForTest(parsedData: any): string {
    return this.computeRowContentHash(parsedData);
  }

  /** Duplicate PO+STO quantity summing (for tests) - mutates and returns the same contexts. */
  static applyDuplicateStoQuantitySumsForTest(
    contexts: Array<{ poNumber: string | null; stoKey: string; parsedData: any }>,
  ): void {
    this.applyDuplicateStoQuantitySums(contexts as RowImportContext[]);
  }

  /** Contract-identity chunk partitioning (for tests). */
  static partitionRowContextsByContractIdentityForTest(
    rows: Array<{ rowIndex: number; contractNumber: string | null; poNumber: string | null }>,
    numChunks: number,
  ): Array<Array<{ rowIndex: number; contractNumber: string | null; poNumber: string | null }>> {
    const asContexts = rows.map((r) => ({
      ...r,
      row: [],
      parsedData: {},
      rowIdentity: null,
      stoKey: '',
      contentHash: null,
    })) as unknown as RowImportContext[];
    return this.partitionRowContextsByContractIdentity(asContexts, numChunks) as unknown as Array<
      Array<{ rowIndex: number; contractNumber: string | null; poNumber: string | null }>
    >;
  }

  /** Parallelism resolution (for tests). */
  static resolveImportParallelismForTest(rowCount: number): number {
    return this.resolveImportParallelism(rowCount);
  }

  /** In-memory cancel flag (for tests). */
  static markCancelRequestedForTest(importId: string): void {
    cancelRequestedImportIds.add(importId);
  }

  static isCancelRequestedForTest(importId: string): boolean {
    return this.isCancelRequested(importId);
  }

  static clearCancelRequestForTest(importId: string): void {
    this.clearCancelRequest(importId);
  }
}

