import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

vi.mock('../database/connection', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('./truckingRealization.service', () => ({
  syncTruckingQuantityDeliveredFromDailyActuals: vi.fn().mockResolvedValue(0),
}));

vi.mock('../utils/operationId', () => ({
  allocateNextSyntheticSequence: vi.fn().mockResolvedValue(1),
  buildSyntheticOperationId: vi.fn(
    (_mode: string, dmy: string, seq: number) => `OP-LAND-${dmy}${String(seq).padStart(4, '0')}`,
  ),
  formatDDMMYYYY: vi.fn(() => '05082026'),
}));

vi.mock('../utils/truckingOperationUniqueness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/truckingOperationUniqueness')>();
  return {
    ...actual,
    findActiveTruckingOpsByContractId: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('./truckingList.service', () => ({
  invalidateTruckingListCache: vi.fn(),
}));

vi.mock('./truckingDedupe.service', () => ({
  dedupeActiveTruckingOpsForPo: vi.fn(),
  scheduleTruckingPipelineRefresh: vi.fn(),
}));

import { getClient, query } from '../database/connection';
import { syncTruckingQuantityDeliveredFromDailyActuals } from '../services/truckingRealization.service';
import { allocateNextSyntheticSequence } from '../utils/operationId';
import { findActiveTruckingOpsByContractId } from '../utils/truckingOperationUniqueness';
import { invalidateTruckingListCache } from './truckingList.service';
import { dedupeActiveTruckingOpsForPo } from './truckingDedupe.service';
import { processWbRekapWorkbookUpload } from './truckingWbImport.service';
import type { WbRekapWorkbookSheet } from '../utils/truckingWbRekapUpload';

type Scenario = {
  opsByPo: Record<string, Row[]>;
  stoToPo: Record<string, string | null>;
  diagnosticsByPo: Record<string, Row>;
  anyStatusCountsByPo: Record<string, { total: number; active: number }>;
  insertedTruckingOps: Row[];
};

function buildScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    opsByPo: {},
    stoToPo: {},
    diagnosticsByPo: {},
    anyStatusCountsByPo: {},
    insertedTruckingOps: [],
    ...overrides,
  };
}

function fakeClientHandler(scenario: Scenario, calls: { text: string; params: unknown[] }[]) {
  return vi.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text: String(text), params });
    const t = String(text);

    if (t === 'BEGIN' || t === 'COMMIT' || t === 'ROLLBACK') {
      return { rows: [] };
    }
    if (t.includes('FROM UNNEST($1::text[]) AS x(sto_key)')) {
      const keys = (params[0] as string[]) ?? [];
      return { rows: keys.map((k) => ({ sto_key: k, po_number: scenario.stoToPo[k] ?? null })) };
    }
    if (t.includes('INNER JOIN contracts c ON c.id = t.contract_id') && t.includes("IN ('FRC', 'LCO')")) {
      const poList = (params[0] as string[]) ?? [];
      const rows: Row[] = [];
      for (const po of poList) {
        for (const opRow of scenario.opsByPo[po] ?? []) rows.push({ ...opRow, po_number: po });
      }
      return { rows };
    }
    if (t.includes('b2b_origin_po')) {
      const poList = (params[0] as string[]) ?? [];
      const rows: Row[] = [];
      for (const po of poList) {
        const diag = scenario.diagnosticsByPo[po];
        if (diag) rows.push({ po_number: po, ...diag });
      }
      return { rows };
    }
    if (t.includes('COUNT(*) FILTER') && t.includes('AS active')) {
      const poList = (params[0] as string[]) ?? [];
      const rows: Row[] = [];
      for (const po of poList) {
        const c = scenario.anyStatusCountsByPo[po];
        if (c) rows.push({ po_number: po, total: String(c.total), active: String(c.active) });
      }
      return { rows };
    }
    if (t.includes("VALUES ($1::uuid, $2, 'UNPLANNED', '[]'::jsonb)")) {
      const id = `new-op-${scenario.insertedTruckingOps.length + 1}`;
      const operationId = String(params[1]);
      scenario.insertedTruckingOps.push({ contractUuid: params[0], operationId, id });
      return { rows: [{ id }] };
    }
    if (t.includes('WHERE t.id = ANY($1::uuid[])') && t.includes('ORDER BY')) {
      const ids = (params[0] as string[]) ?? [];
      return { rows: ids.length ? [{ id: ids[0] }] : [] };
    }
    return { rows: [] };
  });
}

function setupScenario(scenario: Scenario) {
  vi.mocked(dedupeActiveTruckingOpsForPo).mockImplementation(async (_client, po) => ({
    keeperId: 'op-1',
    cancelledIds: [],
    dedupedIds: ['op-2'],
    contractUuid: `contract-${po}`,
  }));
  const calls: { text: string; params: unknown[] }[] = [];
  const client = {
    query: fakeClientHandler(scenario, calls),
    release: vi.fn(),
  };
  vi.mocked(getClient).mockResolvedValue(client as never);
  vi.mocked(query).mockImplementation(async (text: string, params?: unknown[]) => {
    const t = String(text);
    if (t.includes('FROM UNNEST($1::text[]) AS x(sto_key)')) {
      const keys = ((params ?? [])[0] as string[]) ?? [];
      return { rows: keys.map((k) => ({ sto_key: k, po_number: scenario.stoToPo[k] ?? null })) } as never;
    }
    if (t.includes('INSERT INTO trucking_wb_imports')) {
      return { rows: [{ id: 'import-1' }] } as never;
    }
    return { rows: [] } as never;
  });
  return { client, calls };
}

function sheet(rows: Array<[number, string, string, number, number]>): WbRekapWorkbookSheet[] {
  return [
    {
      sheetName: 'CPO',
      matrix: [['No.', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'], ...rows],
    },
  ];
}

describe('processWbRekapWorkbookUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findActiveTruckingOpsByContractId).mockResolvedValue([]);
  });

  it('applies a WB row against the resolved active FRC/LCO operation', async () => {
    const scenario = buildScenario({
      opsByPo: {
        '1001029784': [
          { id: 'op-1', operation_id: 'OP-LAND-0001', status: 'PLANNED', incoterm: 'LCO', product: 'CPO' },
        ],
      },
    });
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001029784', '01/06/2026', 17200, 17140]]),
    });

    expect(result.operationFailures).toEqual([]);
    expect(result.rowsUpserted).toBe(1);
    expect(result.operationsUpdated).toBe(1);
    expect(result.status).toBe('completed');
    expect(syncTruckingQuantityDeliveredFromDailyActuals).toHaveBeenCalledTimes(1);
    expect(syncTruckingQuantityDeliveredFromDailyActuals).toHaveBeenCalledWith(expect.anything(), 'op-1');
    expect(invalidateTruckingListCache).toHaveBeenCalledTimes(1);
  });

  it('runs sync + promote exactly once per touched operation even with many date rows', async () => {
    const scenario = buildScenario({
      opsByPo: {
        '1001029784': [
          { id: 'op-1', operation_id: 'OP-LAND-0001', status: 'PLANNED', incoterm: 'LCO', product: 'CPO' },
        ],
      },
    });
    const { calls } = setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([
        [1, '1001029784', '01/06/2026', 17200, 17140],
        [2, '1001029784', '02/06/2026', 8000, 7900],
        [3, '1001029784', '03/06/2026', 5000, 4900],
      ]),
    });

    expect(result.rowsUpserted).toBe(3);
    expect(result.operationsUpdated).toBe(1);
    // Deferred: sync/promote run once per operation, not once per date row.
    expect(syncTruckingQuantityDeliveredFromDailyActuals).toHaveBeenCalledTimes(1);
    const promoteCalls = calls.filter((c) => c.text.includes('UPDATE trucking_operations') && c.text.includes('IN_PROGRESS'));
    expect(promoteCalls).toHaveLength(1);
    // Promote uses the earliest date across the operation's rows.
    expect(promoteCalls[0]?.params[1]).toBe('2026-06-01');
  });

  it('wraps the apply loop in one BEGIN/COMMIT transaction', async () => {
    const scenario = buildScenario({
      opsByPo: {
        '1001029784': [
          { id: 'op-1', operation_id: 'OP-LAND-0001', status: 'PLANNED', incoterm: 'LCO', product: 'CPO' },
        ],
      },
    });
    const { calls } = setupScenario(scenario);

    await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001029784', '01/06/2026', 17200, 17140]]),
    });

    expect(calls.filter((c) => c.text === 'BEGIN')).toHaveLength(1);
    expect(calls.filter((c) => c.text === 'COMMIT')).toHaveLength(1);
    expect(calls.filter((c) => c.text === 'ROLLBACK')).toHaveLength(0);
  });

  it('rolls back the transaction and rethrows when the apply step fails', async () => {
    const scenario = buildScenario({
      opsByPo: {
        '1001029784': [
          { id: 'op-1', operation_id: 'OP-LAND-0001', status: 'PLANNED', incoterm: 'LCO', product: 'CPO' },
        ],
      },
    });
    const { client, calls } = setupScenario(scenario);
    const originalQuery = client.query;
    client.query = vi.fn(async (text: string, params: unknown[] = []) => {
      if (String(text).includes('INSERT INTO trucking_daily_actuals')) {
        throw new Error('boom');
      }
      return originalQuery(text, params);
    }) as never;
    vi.mocked(getClient).mockResolvedValue(client as never);

    await expect(
      processWbRekapWorkbookUpload({
        originalFilename: 'wb.xlsx',
        uploadedBy: null,
        sheets: sheet([[1, '1001029784', '01/06/2026', 17200, 17140]]),
      }),
    ).rejects.toThrow('boom');

    expect(calls.filter((c) => c.text === 'ROLLBACK')).toHaveLength(1);
    expect(calls.filter((c) => c.text === 'COMMIT')).toHaveLength(0);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('sums multiple STO tickets for the same PO+date into a single PO-level upsert (blank STO)', async () => {
    const scenario = buildScenario({
      opsByPo: {
        '1001029784': [
          { id: 'op-1', operation_id: 'OP-LAND-0001', status: 'PLANNED', incoterm: 'LCO', product: 'CPO' },
        ],
      },
    });
    const { calls } = setupScenario(scenario);

    const sheets: WbRekapWorkbookSheet[] = [
      {
        sheetName: 'CPO',
        matrix: [
          ['No.', 'STO', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
          [1, '1006018596', '1001029784', '01/06/2026', 17200, 17140],
          [2, '1006018597', '1001029784', '01/06/2026', 17350, 17310],
        ],
      },
    ];

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets,
    });

    expect(result.aggregatedPoDates).toBe(1);
    expect(result.rowsUpserted).toBe(1);
    const insertCall = calls.find((c) => c.text.includes('INSERT INTO trucking_daily_actuals'));
    expect(insertCall).toBeTruthy();
    // quantity_delivery_kg / quantity_receive_kg are summed across both STOs; sto_number stays blank (PO-level).
    expect(insertCall?.params[4]).toBe(17200 + 17350);
    expect(insertCall?.params[5]).toBe(17140 + 17310);
    expect(insertCall?.params[6]).toBe('');
  });

  it('reports "not found in SAP" when the PO has no contract at all', async () => {
    const scenario = buildScenario();
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '9999999999', '01/06/2026', 1000, 900]]),
    });

    expect(result.rowsUpserted).toBe(0);
    expect(result.operationFailures).toHaveLength(1);
    expect(result.operationFailures[0]?.reason).toMatch(/^PO "9999999999" not found in SAP/);
    expect(result.operationFailures[0]?.reason).not.toContain('/STO');
    expect(result.operationFailures[0]?.reason).not.toContain('PO/STO');
  });

  it('reports a single PO identity (not a joined PO/STO string) when neither the PO nor its STO match a contract', async () => {
    const scenario = buildScenario();
    setupScenario(scenario);

    const sheets: WbRekapWorkbookSheet[] = [
      {
        sheetName: 'CPO',
        matrix: [
          ['No.', 'STO', 'PO/SO', 'Tanggal Masuk', 'Netto PKS', 'Netto EUP'],
          [1, '1366000998', '1361001948', '15/01/2026', 1000, 900],
        ],
      },
    ];

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets,
    });

    expect(result.operationFailures).toHaveLength(1);
    expect(result.operationFailures[0]?.po_number).toBe('1361001948');
    expect(result.operationFailures[0]?.reason).toBe(
      'PO "1361001948" not found in SAP — verify the PO in the WB file matches an existing contract',
    );
  });

  it('reports the B2B child rejection for a B2B child PO', async () => {
    const scenario = buildScenario({
      diagnosticsByPo: {
        '1641000321': {
          contract_uuid: 'contract-b2b',
          transport_mode: 'LAND',
          incoterm: 'FRC',
          import_status: 'Open',
          b2b_origin_po: '1001029450',
          contract_type_norm: 'B2B',
        },
      },
    });
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1641000321', '01/06/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toHaveLength(1);
    expect(result.operationFailures[0]?.reason).toContain('B2B child PO');
    expect(result.operationFailures[0]?.reason).toContain('1001029450');
  });

  it('reports CANCELLED when all existing operations for the PO are cancelled', async () => {
    const scenario = buildScenario({
      diagnosticsByPo: {
        '1001029784': {
          contract_uuid: 'contract-1',
          transport_mode: 'LAND',
          incoterm: 'LCO',
          import_status: 'Open',
          b2b_origin_po: null,
          contract_type_norm: null,
        },
      },
      anyStatusCountsByPo: {
        '1001029784': { total: 2, active: 0 },
      },
    });
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001029784', '01/06/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toHaveLength(1);
    expect(result.operationFailures[0]?.reason).toMatch(/CANCELLED/);
  });

  it('reports SEA transport when the contract is SEA (no auto-create)', async () => {
    const scenario = buildScenario({
      diagnosticsByPo: {
        '1001029784': {
          contract_uuid: 'contract-sea',
          transport_mode: 'SEA',
          incoterm: 'FRC',
          import_status: 'Open',
          b2b_origin_po: null,
          contract_type_norm: null,
        },
      },
    });
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001029784', '01/06/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toHaveLength(1);
    expect(result.operationFailures[0]?.reason).toMatch(/SEA transport/);
    expect(allocateNextSyntheticSequence).not.toHaveBeenCalled();
  });

  it('reports GR-Close when the contract delivery status is Close (no auto-create)', async () => {
    const scenario = buildScenario({
      diagnosticsByPo: {
        '1001029784': {
          contract_uuid: 'contract-closed',
          transport_mode: 'LAND',
          incoterm: 'LCO',
          import_status: 'Close',
          b2b_origin_po: null,
          contract_type_norm: null,
        },
      },
    });
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001029784', '01/06/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toHaveLength(1);
    expect(result.operationFailures[0]?.reason).toMatch(/Close/);
    expect(allocateNextSyntheticSequence).not.toHaveBeenCalled();
  });

  it('still applies the WB row when the contract is GR-Close but an operation already exists', async () => {
    // sqlTruckingResolvedDeliveryQty / sqlTruckingResolvedReceiveQty always use the SAP
    // quantity once GR is Close, regardless of trucking_daily_actuals — so storing the
    // WB row here has no effect on displayed quantity, but the row should no longer be
    // rejected with a "Cannot update quantity from WB" failure.
    const scenario = buildScenario({
      opsByPo: {
        '1001031177': [
          { id: 'op-closed', operation_id: 'OP-LAND-0009', status: 'IN_PROGRESS', incoterm: 'LCO', product: 'CPO' },
        ],
      },
      diagnosticsByPo: {
        '1001031177': {
          contract_uuid: 'contract-closed-with-op',
          transport_mode: 'LAND',
          incoterm: 'LCO',
          import_status: 'Close',
          b2b_origin_po: null,
          contract_type_norm: null,
        },
      },
    });
    const { calls } = setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001031177', '23/07/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toEqual([]);
    expect(result.rowsUpserted).toBe(1);
    expect(result.operationsUpdated).toBe(1);
    const insertCall = calls.find((c) => c.text.includes('INSERT INTO trucking_daily_actuals'));
    expect(insertCall).toBeTruthy();
  });

  it('reports wrong incoterm when the contract is open and non-SEA but not FRC/LCO (no auto-create)', async () => {
    const scenario = buildScenario({
      diagnosticsByPo: {
        '1001029784': {
          contract_uuid: 'contract-fob',
          transport_mode: 'LAND',
          incoterm: 'FOB',
          import_status: 'Open',
          b2b_origin_po: null,
          contract_type_norm: null,
        },
      },
    });
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001029784', '01/06/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toHaveLength(1);
    expect(result.operationFailures[0]?.reason).toMatch(/incoterm "FOB"/);
    expect(allocateNextSyntheticSequence).not.toHaveBeenCalled();
  });

  it('auto-creates a minimal UNPLANNED operation for the clean case (FRC/LCO, open, non-SEA, zero ops)', async () => {
    const scenario = buildScenario({
      diagnosticsByPo: {
        '1001030999': {
          contract_uuid: 'contract-clean',
          transport_mode: 'LAND',
          incoterm: 'LCO',
          import_status: 'Open',
          b2b_origin_po: null,
          contract_type_norm: null,
        },
      },
    });
    setupScenario(scenario);
    vi.mocked(allocateNextSyntheticSequence).mockResolvedValue(3);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001030999', '01/06/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toEqual([]);
    expect(result.rowsUpserted).toBe(1);
    expect(scenario.insertedTruckingOps).toHaveLength(1);
    expect(scenario.insertedTruckingOps[0]?.contractUuid).toBe('contract-clean');
    expect(scenario.insertedTruckingOps[0]?.operationId).toBe('OP-LAND-050820260003');
    expect(invalidateTruckingListCache).toHaveBeenCalledTimes(1);
  });

  it('dedupes auto-create within the same upload batch (multiple date rows, same PO → one operation)', async () => {
    const scenario = buildScenario({
      diagnosticsByPo: {
        '1001030999': {
          contract_uuid: 'contract-clean',
          transport_mode: 'LAND',
          incoterm: 'LCO',
          import_status: 'Open',
          b2b_origin_po: null,
          contract_type_norm: null,
        },
      },
    });
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([
        [1, '1001030999', '01/06/2026', 1000, 900],
        [2, '1001030999', '02/06/2026', 1200, 1100],
      ]),
    });

    expect(result.rowsUpserted).toBe(2);
    expect(result.operationsUpdated).toBe(1);
    expect(scenario.insertedTruckingOps).toHaveLength(1);
    expect(allocateNextSyntheticSequence).toHaveBeenCalledTimes(1);
    expect(syncTruckingQuantityDeliveredFromDailyActuals).toHaveBeenCalledTimes(1);
  });

  it('does not auto-create when a concurrent active op already exists for the contract (race guard)', async () => {
    const scenario = buildScenario({
      diagnosticsByPo: {
        '1001030999': {
          contract_uuid: 'contract-race',
          transport_mode: 'LAND',
          incoterm: 'LCO',
          import_status: 'Open',
          b2b_origin_po: null,
          contract_type_norm: null,
        },
      },
    });
    setupScenario(scenario);
    vi.mocked(findActiveTruckingOpsByContractId).mockResolvedValue([
      { id: 'op-race', operation_id: 'OP-LAND-RACE', status: 'PLANNED' },
    ] as never);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001030999', '01/06/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toEqual([]);
    expect(result.rowsUpserted).toBe(1);
    expect(scenario.insertedTruckingOps).toHaveLength(0);
    expect(allocateNextSyntheticSequence).not.toHaveBeenCalled();
  });

  it('auto-dedupes soft and applies WB to keeper when more than one active op shares the PO', async () => {
    const scenario = buildScenario({
      opsByPo: {
        '1001029784': [
          { id: 'op-1', operation_id: 'OP-LAND-0001', status: 'PLANNED', incoterm: 'LCO', product: 'CPO' },
          { id: 'op-2', operation_id: 'OP-LAND-0002', status: 'PLANNED', incoterm: 'LCO', product: 'CPO' },
        ],
      },
    });
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001029784', '01/06/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toEqual([]);
    expect(result.rowsUpserted).toBe(1);
    expect(result.operationWarnings).toEqual([]);
    expect(result.operationDeduped).toHaveLength(1);
    expect(result.operationDeduped[0]?.reason).toMatch(/merged duplicate operation/);
    expect(result.operationDeduped[0]?.reason).toMatch(/KLIP soft dedupe/);
    expect(dedupeActiveTruckingOpsForPo).toHaveBeenCalledWith(
      expect.anything(),
      '1001029784',
      expect.objectContaining({ mode: 'soft_dedupe', dedupedReason: 'wb_import_auto' }),
    );
  });

  it('prefers non-COMPLETED op when PO has completed and active siblings', async () => {
    const scenario = buildScenario({
      opsByPo: {
        '1001029784': [
          { id: 'op-completed', operation_id: 'OP-LAND-OLD', status: 'COMPLETED', incoterm: 'LCO', product: 'CPO' },
          { id: 'op-active', operation_id: 'OP-LAND-NEW', status: 'PLANNED', incoterm: 'LCO', product: 'CPO' },
        ],
      },
    });
    setupScenario(scenario);

    const result = await processWbRekapWorkbookUpload({
      originalFilename: 'wb.xlsx',
      uploadedBy: null,
      sheets: sheet([[1, '1001029784', '01/06/2026', 1000, 900]]),
    });

    expect(result.operationFailures).toEqual([]);
    expect(result.operationWarnings).toEqual([]);
    expect(result.rowsUpserted).toBe(1);
    expect(syncTruckingQuantityDeliveredFromDailyActuals).toHaveBeenCalledWith(expect.anything(), 'op-active');
  });
});
