import { afterEach, describe, expect, it } from 'vitest';
import { SapMasterV2ImportService } from './sapMasterV2Import.service';

describe('SapMasterV2ImportService content hash (Phase 1: skip-unchanged-rows)', () => {
  it('is deterministic for the same parsedData', () => {
    const parsedData = {
      contract: { po_no: 'PO-1', contract_no: 'CTR-1', supplier: 'PT Supplier', product: 'CPO' },
      shipment: { sto_no: 'STO-1', vessel: 'MV Test' },
      quality: [],
      trucking: [],
      payment: {},
      vessel: {},
      raw: { 'PO No': 'PO-1' },
    };

    const hash1 = SapMasterV2ImportService.computeRowContentHashForTest(parsedData);
    const hash2 = SapMasterV2ImportService.computeRowContentHashForTest(
      JSON.parse(JSON.stringify(parsedData)),
    );

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any field in parsedData changes', () => {
    const base = {
      contract: { po_no: 'PO-1', contract_no: 'CTR-1' },
      shipment: { sto_no: 'STO-1' },
    };
    const changed = {
      contract: { po_no: 'PO-1', contract_no: 'CTR-1' },
      shipment: { sto_no: 'STO-1', vessel: 'MV New' },
    };

    const hashBase = SapMasterV2ImportService.computeRowContentHashForTest(base);
    const hashChanged = SapMasterV2ImportService.computeRowContentHashForTest(changed);

    expect(hashBase).not.toBe(hashChanged);
  });

  it('does not change when only bookkeeping fields (import_id/raw_data_id) are absent from parsedData', () => {
    // parsedData never carries import_id/raw_data_id (those are separate SQL columns/params),
    // so re-hashing the same business fields across two different imports must match.
    const rowUpload1 = { contract: { po_no: 'PO-9' }, shipment: { sto_no: 'STO-9' } };
    const rowUpload2 = { contract: { po_no: 'PO-9' }, shipment: { sto_no: 'STO-9' } };

    expect(SapMasterV2ImportService.computeRowContentHashForTest(rowUpload1)).toBe(
      SapMasterV2ImportService.computeRowContentHashForTest(rowUpload2),
    );
  });
});

describe('SapMasterV2ImportService chunk partitioning (Phase 3: parallel chunked processing)', () => {
  it('keeps every row sharing a contract number in the same chunk', () => {
    const rows = [
      { rowIndex: 0, contractNumber: 'CTR-A', poNumber: 'PO-1' },
      { rowIndex: 1, contractNumber: 'CTR-A', poNumber: 'PO-2' }, // same contract, different PO
      { rowIndex: 2, contractNumber: 'CTR-B', poNumber: 'PO-3' },
      { rowIndex: 3, contractNumber: 'CTR-B', poNumber: 'PO-4' },
      { rowIndex: 4, contractNumber: 'CTR-C', poNumber: 'PO-5' },
    ];

    const chunks = SapMasterV2ImportService.partitionRowContextsByContractIdentityForTest(rows, 3);

    const chunkOfRow = (rowIndex: number) =>
      chunks.findIndex((chunk) => chunk.some((r) => r.rowIndex === rowIndex));

    expect(chunkOfRow(0)).toBe(chunkOfRow(1)); // CTR-A rows together
    expect(chunkOfRow(2)).toBe(chunkOfRow(3)); // CTR-B rows together
    expect(chunks.reduce((sum, c) => sum + c.length, 0)).toBe(rows.length); // no row lost/duplicated
  });

  it('keeps every row sharing a PO number in the same chunk when contract number is absent', () => {
    const rows = [
      { rowIndex: 0, contractNumber: null, poNumber: 'PO-1' },
      { rowIndex: 1, contractNumber: null, poNumber: 'PO-1' },
      { rowIndex: 2, contractNumber: null, poNumber: 'PO-2' },
    ];

    const chunks = SapMasterV2ImportService.partitionRowContextsByContractIdentityForTest(rows, 4);
    const chunkOfRow = (rowIndex: number) =>
      chunks.findIndex((chunk) => chunk.some((r) => r.rowIndex === rowIndex));

    expect(chunkOfRow(0)).toBe(chunkOfRow(1));
  });

  it('never produces more chunks than requested, and never drops a row', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      rowIndex: i,
      contractNumber: `CTR-${i % 7}`,
      poNumber: `PO-${i}`,
    }));

    const chunks = SapMasterV2ImportService.partitionRowContextsByContractIdentityForTest(rows, 4);

    expect(chunks.length).toBeLessThanOrEqual(4);
    expect(chunks.reduce((sum, c) => sum + c.length, 0)).toBe(rows.length);
    const allRowIndexes = new Set(chunks.flatMap((c) => c.map((r) => r.rowIndex)));
    expect(allRowIndexes.size).toBe(rows.length);
  });

  it('falls back to isolating rows with neither contract number nor PO number', () => {
    const rows = [
      { rowIndex: 0, contractNumber: null, poNumber: null },
      { rowIndex: 1, contractNumber: null, poNumber: null },
    ];

    const chunks = SapMasterV2ImportService.partitionRowContextsByContractIdentityForTest(rows, 2);

    // Rows with no identity at all must not be silently merged into the same bucket by key
    // collision (they'll fail row validation anyway - PO number is required - but must still be
    // accounted for individually).
    expect(chunks.reduce((sum, c) => sum + c.length, 0)).toBe(2);
  });

  it('returns a single chunk when numChunks is 1 (serial fallback path)', () => {
    const rows = [
      { rowIndex: 0, contractNumber: 'CTR-A', poNumber: 'PO-1' },
      { rowIndex: 1, contractNumber: 'CTR-B', poNumber: 'PO-2' },
    ];

    const chunks = SapMasterV2ImportService.partitionRowContextsByContractIdentityForTest(rows, 1);

    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(2);
  });
});

describe('SapMasterV2ImportService import parallelism', () => {
  const originalEnv = process.env.SAP_IMPORT_PARALLELISM;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SAP_IMPORT_PARALLELISM;
    else process.env.SAP_IMPORT_PARALLELISM = originalEnv;
  });

  it('runs small files (< 50 rows) fully serially regardless of configuration', () => {
    process.env.SAP_IMPORT_PARALLELISM = '8';
    expect(SapMasterV2ImportService.resolveImportParallelismForTest(10)).toBe(1);
  });

  it('defaults to 4 workers for larger files when unset', () => {
    delete process.env.SAP_IMPORT_PARALLELISM;
    expect(SapMasterV2ImportService.resolveImportParallelismForTest(500)).toBe(4);
  });

  it('respects SAP_IMPORT_PARALLELISM=1 as the full serial fallback', () => {
    process.env.SAP_IMPORT_PARALLELISM = '1';
    expect(SapMasterV2ImportService.resolveImportParallelismForTest(500)).toBe(1);
  });

  it('clamps configured parallelism to a sane [1, 8] range', () => {
    process.env.SAP_IMPORT_PARALLELISM = '99';
    expect(SapMasterV2ImportService.resolveImportParallelismForTest(500)).toBe(8);

    // 0 (and below) is not a usable worker count, so it falls back to the default like an
    // unset/invalid value would - it does not clamp up to 1.
    process.env.SAP_IMPORT_PARALLELISM = '0';
    expect(SapMasterV2ImportService.resolveImportParallelismForTest(500)).toBe(4);

    process.env.SAP_IMPORT_PARALLELISM = 'not-a-number';
    expect(SapMasterV2ImportService.resolveImportParallelismForTest(500)).toBe(4);
  });
});

describe('SapMasterV2ImportService cancel request flag', () => {
  const importId = '00000000-0000-4000-8000-000000000099';

  afterEach(() => {
    SapMasterV2ImportService.clearCancelRequestForTest(importId);
  });

  it('is off by default and turns on after markCancelRequested', () => {
    expect(SapMasterV2ImportService.isCancelRequestedForTest(importId)).toBe(false);
    SapMasterV2ImportService.markCancelRequestedForTest(importId);
    expect(SapMasterV2ImportService.isCancelRequestedForTest(importId)).toBe(true);
  });

  it('does not leak the flag to a different import id', () => {
    const otherId = '00000000-0000-4000-8000-000000000100';
    SapMasterV2ImportService.markCancelRequestedForTest(importId);
    expect(SapMasterV2ImportService.isCancelRequestedForTest(otherId)).toBe(false);
    SapMasterV2ImportService.clearCancelRequestForTest(otherId);
  });

  it('clears the flag so a later import with the same id can run again', () => {
    SapMasterV2ImportService.markCancelRequestedForTest(importId);
    SapMasterV2ImportService.clearCancelRequestForTest(importId);
    expect(SapMasterV2ImportService.isCancelRequestedForTest(importId)).toBe(false);
  });
});
