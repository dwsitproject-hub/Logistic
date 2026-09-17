import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { SapMasterV2ImportService } from '../../services/sapMasterV2Import.service';
import { SQL_CONTRACT_IMPORT_STATUS } from '../../utils/contractDeliveryStatus';

/**
 * Parity guardrail for the SAP MASTER v2 import "Round 2" performance work (raised default
 * parallelism, batch-prefetched shipment exact-id match, per-row KLIP-activity memoization,
 * batched quality-survey inserts - see the SAP import optimization plan). None of that touches
 * decision logic or write order - this suite proves it by asserting the same golden values the
 * user asked to protect (contract qty, delivery/receive qty, OS qty, contract status, shipment
 * status) come out identical whether run against the code before or after those changes.
 *
 * Run against a real Postgres (no mocking) via the real import pipeline
 * (SapMasterV2ImportService.importMasterV2File), same rationale as
 * sapMasterV2ImportPerformance.integration.test.ts.
 */

const HEADERS = [
  'Contract No.',
  'PO No.',
  'Supplier',
  'Product',
  'Contract Quantity',
  'Contract Qty UoM',
  'Sea / Land',
  'Incoterm',
  'STO No.',
  'STO Quantity',
  'GR PO Status',
  'GR STO Status',
  'Vessel Name',
  'ATA Arrival at Loading Port 1',
  'Quantity Delivery',
  'Quantity Receive',
  'FFA',
];

interface FixtureRow {
  contractNo: string;
  poNo: string;
  supplier: string;
  product: string;
  qty: number;
  uom: string;
  seaLand: string;
  incoterm: string;
  stoNo: string;
  stoQty: number;
  grPoStatus: string;
  grStoStatus: string;
  vesselName: string;
  ataArrivalLoading: string;
  qtyDelivery: number;
  qtyReceive: number;
  ffa: number;
}

function row(overrides: Partial<FixtureRow> & Pick<FixtureRow, 'contractNo' | 'poNo' | 'stoNo'>): FixtureRow {
  return {
    supplier: 'IT-Supplier-Parity',
    product: 'CPO',
    qty: 1000,
    uom: 'MT',
    seaLand: 'SEA',
    incoterm: 'CIF',
    stoQty: 500,
    grPoStatus: 'Open',
    grStoStatus: 'Open',
    vesselName: 'MV Parity One',
    ataArrivalLoading: '',
    qtyDelivery: 0,
    qtyReceive: 0,
    ffa: 0,
    ...overrides,
  };
}

function writeFixtureWorkbook(filePath: string, rows: FixtureRow[]): void {
  const aoa = [
    HEADERS,
    ...rows.map((r) => [
      r.contractNo,
      r.poNo,
      r.supplier,
      r.product,
      String(r.qty),
      r.uom,
      r.seaLand,
      r.incoterm,
      r.stoNo,
      String(r.stoQty),
      r.grPoStatus,
      r.grStoStatus,
      r.vesselName,
      r.ataArrivalLoading,
      String(r.qtyDelivery),
      String(r.qtyReceive),
      String(r.ffa),
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Logistic Report');
  XLSX.writeFile(workbook, filePath);
}

const PREFIX = 'ITEST-WPPARITY';

async function cleanupFixtureData(importIds: string[] = []): Promise<void> {
  await query(`DELETE FROM quality_surveys WHERE shipment_id IN (SELECT id FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1))`, [`${PREFIX}-%`]);
  await query(`DELETE FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${PREFIX}-%`]);
  await query(`DELETE FROM contract_stos WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${PREFIX}-%`]);
  await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${PREFIX}-%`]);
  if (importIds.length > 0) {
    await query(`DELETE FROM sap_data_imports WHERE id = ANY($1::uuid[])`, [importIds]);
  }
  await query(
    `DELETE FROM sap_data_imports
     WHERE id IN (SELECT DISTINCT import_id FROM sap_processed_data WHERE contract_number LIKE $1)`,
    [`${PREFIX}-%`],
  );
}

describe('Integration: SAP MASTER v2 import write-path parity (Round 2 optimization guardrail)', () => {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, 'itest-wpparity.xlsx');
  const createdImportIds: string[] = [];

  const rows: FixtureRow[] = [
    // Two SEA shipments on two different contracts, each with its own vessel - exercises the new
    // batch-prefetched shipment exact-id lookup across multiple distinct shipment_ids in one chunk.
    row({
      contractNo: `${PREFIX}-CTR-A`, poNo: `${PREFIX}-PO-A1`, stoNo: `${PREFIX}-STO-A1`,
      grPoStatus: 'Close', grStoStatus: 'Close',
      ataArrivalLoading: '2031-06-01', qtyDelivery: 480, qtyReceive: 470,
    }),
    row({
      contractNo: `${PREFIX}-CTR-B`, poNo: `${PREFIX}-PO-B1`, stoNo: `${PREFIX}-STO-B1`,
      vesselName: 'MV Parity Two', qty: 800, stoQty: 300,
      grPoStatus: 'Open', grStoStatus: 'Open',
    }),
    // Quality entry on contract A's row (FFA) exercises the new batched quality-survey insert.
    row({
      contractNo: `${PREFIX}-CTR-A`, poNo: `${PREFIX}-PO-A1`, stoNo: `${PREFIX}-STO-A1`,
      grPoStatus: 'Close', grStoStatus: 'Close',
      ataArrivalLoading: '2031-06-01', qtyDelivery: 480, qtyReceive: 470, ffa: 0.12,
    }),
  ];

  beforeAll(async () => {
    await cleanupFixtureData();
    writeFixtureWorkbook(filePath, rows);
  }, 30000);

  afterAll(async () => {
    await cleanupFixtureData(createdImportIds);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('imports successfully with no failures', async () => {
    const result = await SapMasterV2ImportService.importMasterV2File(filePath, { source: 'manual' });
    if (result.importId) createdImportIds.push(result.importId);
    expect(result.success).toBe(true);
    expect(result.failedRecords).toBe(0);
  }, 60000);

  it('contract quantity (contracts.quantity_ordered) matches the imported value, normalized MT->KG', async () => {
    const a = await query(`SELECT quantity_ordered FROM contracts WHERE contract_id = $1`, [`${PREFIX}-CTR-A`]);
    expect(Number(a.rows[0].quantity_ordered)).toBeCloseTo(1000 * 1000, 5);

    const b = await query(`SELECT quantity_ordered FROM contracts WHERE contract_id = $1`, [`${PREFIX}-CTR-B`]);
    expect(Number(b.rows[0].quantity_ordered)).toBeCloseTo(800 * 1000, 5);
  });

  it('delivery/receive qty (shipments.quantity_delivered / actual_vessel_qty_receive) match the imported values', async () => {
    // Contract A's two rows share the same PO+STO (STO-A1) - the second (quality-only) row must
    // update the SAME shipment, not create a second one or lose the first row's qty.
    const r = await query(
      `SELECT s.id, s.status, s.quantity_delivered, s.actual_vessel_qty_receive
       FROM shipments s JOIN contracts c ON c.id = s.contract_id
       WHERE c.contract_id = $1`,
      [`${PREFIX}-CTR-A`],
    );
    expect(r.rows.length).toBe(1);
    expect(Number(r.rows[0].quantity_delivered)).toBeCloseTo(480, 2);
    expect(Number(r.rows[0].actual_vessel_qty_receive)).toBeCloseTo(470, 2);
  });

  it('shipment status (deriveShipmentStatus outcome) is COMPLETED once contract A is SAP-closed', async () => {
    const r = await query(
      `SELECT s.status FROM shipments s JOIN contracts c ON c.id = s.contract_id WHERE c.contract_id = $1`,
      [`${PREFIX}-CTR-A`],
    );
    expect(r.rows[0].status).toBe('COMPLETED');
  });

  it('contract status (sqlContractImportStatusExpr outcome) reflects GR PO/STO status: Close for A, Open for B', async () => {
    const a = await query(
      `SELECT ${SQL_CONTRACT_IMPORT_STATUS} AS import_status FROM contracts c WHERE c.contract_id = $1`,
      [`${PREFIX}-CTR-A`],
    );
    expect(a.rows[0].import_status).toBe('Close');

    const b = await query(
      `SELECT ${SQL_CONTRACT_IMPORT_STATUS} AS import_status FROM contracts c WHERE c.contract_id = $1`,
      [`${PREFIX}-CTR-B`],
    );
    expect(b.rows[0].import_status).toBe('Open');
  });

  it('quality surveys: one row per SAP row that carried an FFA value, all attached to the single shipment for that STO', async () => {
    const qs = await query(
      `SELECT qs.ffa FROM quality_surveys qs
       JOIN shipments s ON s.id = qs.shipment_id
       JOIN contracts c ON c.id = s.contract_id
       WHERE c.contract_id = $1
       ORDER BY qs.created_at`,
      [`${PREFIX}-CTR-A`],
    );
    // Both of contract A's rows carry an FFA value (0 and 0.12) - createQualitySurvey has no
    // dedup, so each becomes its own row on the one shipment for STO-A1. The batched-insert
    // change (item 4) must not change this count or content.
    expect(qs.rows.length).toBe(2);
    const ffas = qs.rows.map((row) => Number(row.ffa)).sort((x, y) => x - y);
    expect(ffas[0]).toBeCloseTo(0, 4);
    expect(ffas[1]).toBeCloseTo(0.12, 4);
  });

  it('two distinct SEA shipments across two contracts each keep their own vessel (batch-prefetched shipment-id lookup did not cross-contaminate)', async () => {
    const rows = await query(
      `SELECT c.contract_id, s.vessel_name
       FROM shipments s JOIN contracts c ON c.id = s.contract_id
       WHERE c.contract_id IN ($1, $2)
       ORDER BY c.contract_id`,
      [`${PREFIX}-CTR-A`, `${PREFIX}-CTR-B`],
    );
    expect(rows.rows.length).toBe(2);
    expect(rows.rows[0].vessel_name).toBe('MV Parity One');
    expect(rows.rows[1].vessel_name).toBe('MV Parity Two');
  });

  it('re-importing an updated file for the same PO+STO updates the existing shipment via the prefetch (not a duplicate)', async () => {
    // The batch-prefetch in prefetchExistingShipmentsByPoAndSapId is rebuilt fresh each import
    // run from live DB state, so a second, separate import for the same PO+STO must still find
    // and update the shipment this suite's first import already created - not insert a second one.
    const filePath2 = path.join(tmpDir, 'itest-wpparity-v2.xlsx');
    writeFixtureWorkbook(filePath2, [
      row({
        contractNo: `${PREFIX}-CTR-A`, poNo: `${PREFIX}-PO-A1`, stoNo: `${PREFIX}-STO-A1`,
        vesselName: 'MV Parity One Renamed', grPoStatus: 'Close', grStoStatus: 'Close',
        qtyDelivery: 490, qtyReceive: 485,
      }),
    ]);
    try {
      const result = await SapMasterV2ImportService.importMasterV2File(filePath2, { source: 'manual' });
      if (result.importId) createdImportIds.push(result.importId);
      expect(result.success).toBe(true);
      expect(result.failedRecords).toBe(0);

      const r = await query(
        `SELECT s.id, s.vessel_name, s.quantity_delivered, s.actual_vessel_qty_receive
         FROM shipments s JOIN contracts c ON c.id = s.contract_id
         WHERE c.contract_id = $1`,
        [`${PREFIX}-CTR-A`],
      );
      expect(r.rows.length).toBe(1); // still one shipment, not two
      expect(r.rows[0].vessel_name).toBe('MV Parity One Renamed');
      expect(Number(r.rows[0].quantity_delivered)).toBeCloseTo(490, 2);
      expect(Number(r.rows[0].actual_vessel_qty_receive)).toBeCloseTo(485, 2);
    } finally {
      if (fs.existsSync(filePath2)) fs.unlinkSync(filePath2);
    }
  }, 30000);
});
