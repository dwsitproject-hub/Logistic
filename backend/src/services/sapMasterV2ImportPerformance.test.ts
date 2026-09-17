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

  it('defaults to 6 workers for larger files when unset', () => {
    delete process.env.SAP_IMPORT_PARALLELISM;
    expect(SapMasterV2ImportService.resolveImportParallelismForTest(500)).toBe(6);
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
    expect(SapMasterV2ImportService.resolveImportParallelismForTest(500)).toBe(6);

    process.env.SAP_IMPORT_PARALLELISM = 'not-a-number';
    expect(SapMasterV2ImportService.resolveImportParallelismForTest(500)).toBe(6);
  });
});

describe('SapMasterV2ImportService duplicate PO+STO quantity summing (same-file split STO lines)', () => {
  it('sums sto_quantity across rows sharing the exact same PO+STO and writes the same total to every row', () => {
    const contexts = [
      { poNumber: 'PO-1', stoKey: 'STO-1', parsedData: { contract: { sto_quantity: '100' }, shipment: {} } },
      { poNumber: 'PO-1', stoKey: 'STO-1', parsedData: { contract: { sto_quantity: '50' }, shipment: {} } },
    ];

    SapMasterV2ImportService.applyDuplicateStoQuantitySumsForTest(contexts as any);

    expect(contexts[0].parsedData.contract.sto_quantity).toBe(150);
    expect(contexts[1].parsedData.contract.sto_quantity).toBe(150);
  });

  it('sums trucking delivery/receive quantity per location sequence across the group', () => {
    const contexts = [
      {
        poNumber: 'PO-2',
        stoKey: 'STO-2',
        parsedData: {
          contract: {},
          shipment: {},
          trucking: [
            {
              sequence: 1,
              data: {
                quantity_sent_via_trucking_based_on_surat_jalan: '30',
                quantity_delivered_via_trucking: '28',
              },
            },
          ],
        },
      },
      {
        poNumber: 'PO-2',
        stoKey: 'STO-2',
        parsedData: {
          contract: {},
          shipment: {},
          trucking: [
            {
              sequence: 1,
              data: {
                quantity_sent_via_trucking_based_on_surat_jalan: '20',
                quantity_delivered_via_trucking: '19',
              },
            },
          ],
        },
      },
    ];

    SapMasterV2ImportService.applyDuplicateStoQuantitySumsForTest(contexts as any);

    expect(contexts[0].parsedData.trucking[0].data.quantity_sent_via_trucking_based_on_surat_jalan).toBe(50);
    expect(contexts[0].parsedData.trucking[0].data.quantity_delivered_via_trucking).toBe(47);
    expect(contexts[1].parsedData.trucking[0].data.quantity_sent_via_trucking_based_on_surat_jalan).toBe(50);
    expect(contexts[1].parsedData.trucking[0].data.quantity_delivered_via_trucking).toBe(47);
  });

  it('does not touch contract_quantity - only sto_quantity and trucking delivery/receive are summed', () => {
    const contexts = [
      {
        poNumber: 'PO-3',
        stoKey: 'STO-3',
        parsedData: { contract: { sto_quantity: '10', contract_quantity: '1000' }, shipment: {} },
      },
      {
        poNumber: 'PO-3',
        stoKey: 'STO-3',
        parsedData: { contract: { sto_quantity: '5', contract_quantity: '1000' }, shipment: {} },
      },
    ];

    SapMasterV2ImportService.applyDuplicateStoQuantitySumsForTest(contexts as any);

    expect(contexts[0].parsedData.contract.sto_quantity).toBe(15);
    expect(contexts[0].parsedData.contract.contract_quantity).toBe('1000');
    expect(contexts[1].parsedData.contract.contract_quantity).toBe('1000');
  });

  it('leaves a single row for a PO+STO untouched (no group to sum)', () => {
    const contexts = [
      { poNumber: 'PO-4', stoKey: 'STO-4', parsedData: { contract: { sto_quantity: '42' }, shipment: {} } },
    ];

    SapMasterV2ImportService.applyDuplicateStoQuantitySumsForTest(contexts as any);

    expect(contexts[0].parsedData.contract.sto_quantity).toBe('42');
  });

  it('does not group rows with different STO under the same PO', () => {
    const contexts = [
      { poNumber: 'PO-5', stoKey: 'STO-A', parsedData: { contract: { sto_quantity: '10' }, shipment: {} } },
      { poNumber: 'PO-5', stoKey: 'STO-B', parsedData: { contract: { sto_quantity: '20' }, shipment: {} } },
    ];

    SapMasterV2ImportService.applyDuplicateStoQuantitySumsForTest(contexts as any);

    expect(contexts[0].parsedData.contract.sto_quantity).toBe('10');
    expect(contexts[1].parsedData.contract.sto_quantity).toBe('20');
  });

  it('re-running on the same rows (simulating a re-upload) recomputes the same total rather than doubling it', () => {
    const buildContexts = () => [
      { poNumber: 'PO-6', stoKey: 'STO-6', parsedData: { contract: { sto_quantity: '100' }, shipment: {} } },
      { poNumber: 'PO-6', stoKey: 'STO-6', parsedData: { contract: { sto_quantity: '50' }, shipment: {} } },
    ];

    const firstUpload = buildContexts();
    SapMasterV2ImportService.applyDuplicateStoQuantitySumsForTest(firstUpload as any);
    expect(firstUpload[0].parsedData.contract.sto_quantity).toBe(150);

    // A second upload of the identical file parses fresh raw values from the sheet again
    // (100 and 50), not the previously-summed 150 - summing must start from those raw values
    // each time, not accumulate onto a prior total.
    const secondUpload = buildContexts();
    SapMasterV2ImportService.applyDuplicateStoQuantitySumsForTest(secondUpload as any);
    expect(secondUpload[0].parsedData.contract.sto_quantity).toBe(150);
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
