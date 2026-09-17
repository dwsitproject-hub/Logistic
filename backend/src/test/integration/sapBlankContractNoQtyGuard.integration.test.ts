import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { SapMasterV2ImportService } from '../../services/sapMasterV2Import.service';

/**
 * Regression guard for the Contract Qty corruption reported on PO 1001030860 / 1001029714.
 *
 * SAP emits STO-level rows whose "Contract No." is blank; in those rows the "Contract Quantity"
 * column carries the STO quantity, not the contract quantity (observed: Contract Quantity ==
 * STO Quantity == 4,820 kg while the contract is really 1,000,000 kg). Klip matches contracts by
 * PO number - the stable identifier - so such a row lands on the same contract record and used to
 * overwrite quantity_ordered, understating 32 contracts by 29,361,990 kg in total.
 *
 * The rule under test: a row naming its contract wins outright (so a genuine SAP reduction can
 * still land), a blank-contract row may only raise the value. Both orderings must therefore end
 * on the contract-level figure.
 *
 * Runs the real import pipeline against a real Postgres, same rationale as
 * sapImportWritePathParity.integration.test.ts.
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
];

const PREFIX = 'ITEST-BLANKCTR';
const CONTRACT_NO = `${PREFIX}-CTR`;
const PO_NO = `${PREFIX}-PO`;
const CONTRACT_QTY_KG = 1000000;
const BLANK_ROW_QTY_KG = 4820;

interface Row {
  contractNo: string;
  stoNo: string;
  qty: number;
  stoQty: number;
}

function writeWorkbook(filePath: string, rows: Row[]): void {
  const aoa = [
    HEADERS,
    ...rows.map((r) => [
      r.contractNo,
      PO_NO,
      'IT-Supplier-BlankCtr',
      'SHELL PALM',
      String(r.qty),
      'KG',
      'LAND',
      'LCO',
      r.stoNo,
      String(r.stoQty),
      'Open',
      'Open',
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Logistic Report');
  XLSX.writeFile(workbook, filePath);
}

/** The named row carries the true contract quantity; the blank one carries its STO quantity. */
const NAMED_ROW: Row = {
  contractNo: CONTRACT_NO,
  stoNo: `${PREFIX}-STO-NAMED`,
  qty: CONTRACT_QTY_KG,
  stoQty: 500000,
};
const BLANK_ROW: Row = {
  contractNo: '',
  stoNo: `${PREFIX}-STO-BLANK`,
  qty: BLANK_ROW_QTY_KG,
  stoQty: BLANK_ROW_QTY_KG,
};

async function cleanupFixtureData(): Promise<void> {
  const like = [`${PREFIX}-%`, `PO-${PREFIX}-%`];
  await query(
    `DELETE FROM shipments WHERE contract_id IN (
       SELECT id FROM contracts WHERE contract_id LIKE ANY($1::text[]) OR po_number LIKE $2)`,
    [like, `${PREFIX}-%`],
  );
  await query(
    `DELETE FROM contract_stos WHERE contract_id IN (
       SELECT id FROM contracts WHERE contract_id LIKE ANY($1::text[]) OR po_number LIKE $2)`,
    [like, `${PREFIX}-%`],
  );
  await query(
    `DELETE FROM contracts WHERE contract_id LIKE ANY($1::text[]) OR po_number LIKE $2`,
    [like, `${PREFIX}-%`],
  );
  await query(
    `DELETE FROM sap_data_imports
     WHERE id IN (SELECT DISTINCT import_id FROM sap_processed_data WHERE po_number LIKE $1)`,
    [`${PREFIX}-%`],
  );
}

async function importRows(filePath: string, rows: Row[]): Promise<void> {
  writeWorkbook(filePath, rows);
  const result = await SapMasterV2ImportService.importMasterV2File(filePath, { source: 'manual' });
  expect(result.success).toBe(true);
  expect(result.failedRecords).toBe(0);
}

async function readContractQty(): Promise<number | null> {
  const res = await query(
    `SELECT quantity_ordered FROM contracts WHERE TRIM(po_number) = $1 LIMIT 1`,
    [PO_NO],
  );
  const raw = res.rows[0]?.quantity_ordered;
  return raw == null ? null : Number(raw);
}

describe('Integration: blank-Contract-No SAP rows must not understate contracts.quantity_ordered', () => {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, 'itest-blankctr.xlsx');

  beforeAll(async () => {
    await cleanupFixtureData();
  });

  afterAll(async () => {
    await cleanupFixtureData();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('keeps the contract-level qty when the blank-contract row is processed last', async () => {
    await cleanupFixtureData();
    await importRows(filePath, [NAMED_ROW, BLANK_ROW]);
    expect(await readContractQty()).toBeCloseTo(CONTRACT_QTY_KG, 5);
  }, 120000);

  it('reaches the contract-level qty when the blank-contract row is processed first', async () => {
    await cleanupFixtureData();
    await importRows(filePath, [BLANK_ROW, NAMED_ROW]);
    expect(await readContractQty()).toBeCloseTo(CONTRACT_QTY_KG, 5);
  }, 120000);

  it('re-importing a blank-contract row alone cannot lower an already-correct qty', async () => {
    await cleanupFixtureData();
    await importRows(filePath, [NAMED_ROW]);
    expect(await readContractQty()).toBeCloseTo(CONTRACT_QTY_KG, 5);

    await importRows(filePath, [BLANK_ROW]);
    expect(await readContractQty()).toBeCloseTo(CONTRACT_QTY_KG, 5);
  }, 180000);
});
