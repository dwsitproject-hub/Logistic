import { query } from '../../database/connection';

/**
 * Golden-value fixtures for the Trucking quantity regression suite
 * (see `truckingQuantityRegression.integration.test.ts`).
 *
 * These lock in TODAY's correct `quantity_delivered` / `quantity_receive` /
 * `outstanding_quantity` numbers for both:
 * - the **list** row formula (`buildTruckingListSelectClause` — single latest
 *   `sap_processed_data` row, no multi-STO dedup), and
 * - the **summary** formula (`buildTruckingStatusSummaryCombinedQuery` — STO
 *   expansion + PO-level dedup via `sqlTruckingPoLevelSapQtyWithDedup`),
 * so the planned rewrite of the correlated-subquery SAP resolution SQL can be
 * checked byte-for-byte against real computed values.
 *
 * All values below were hand-derived from the current implementation:
 * - `backend/src/utils/truckingQuantitySql.ts`
 * - `backend/src/utils/truckingListSelectSql.ts` (list path)
 * - `backend/src/utils/truckingListStoExpandSql.ts` + `truckingStatusSummaryCombinedSql.ts` (summary path)
 *
 * Date scope: all fixtures use `contract_date` in [2031-06-01, 2031-06-30] — a
 * range far from any other fixture/seed data so summary aggregates over this
 * window are exact (no bleed-over from other tests).
 */

export const TRUCKING_QTY_DATE_FROM = '2031-06-01';
export const TRUCKING_QTY_DATE_TO = '2031-06-30';
export const TRUCKING_QTY_CONTRACT_DATE = '2031-06-15';

export interface TruckingQtyExpected {
  quantityDelivered: number;
  quantityReceive: number;
  outstandingQuantity: number;
}

/**
 * Expected values for a trucking PO row — verified identical on both:
 * - the **list** row (`GET /api/trucking?skipSapJoin=false&contract=<id>`), and
 * - the **summary** endpoint's per-PO STO expansion (`summaryOnly=true` /
 *   `buildTruckingStatusSummaryCombinedQuery`).
 *
 * Both paths ultimately render through the *same* STO-expansion + dedup wrapper
 * (`buildTruckingFilteredExpansionSql` / `buildTruckingListExpansionSql` in
 * `truckingListStoExpandSql.ts`) once `skipSapJoin=false` — `buildTruckingListSelectClause`'s
 * single-latest-row formula is only the un-expanded seed CTE, not what is ultimately displayed.
 * So there is exactly one PO-level dedup formula to protect (`sqlTruckingPoLevelSapQtyWithDedup`),
 * confirmed empirically by running this suite against the current (correct) implementation.
 */
export const TRUCKING_QTY_EXPECTED: Record<string, TruckingQtyExpected> = {
  'ITRK-A': { quantityDelivered: 40000, quantityReceive: 35000, outstandingQuantity: 60000 },
  // Dedup branch: Σ(70000+70000=140000) > 1.2×100000 and both rows < 95% of contract qty
  // (so neither is excluded as "looks like a lone full-PO duplicate") → falls back to MAX = 70000.
  'ITRK-B': { quantityDelivered: 70000, quantityReceive: 65000, outstandingQuantity: 30000 },
  // Legit-split branch: Σ(40000+45000=85000) <= 1.2×100000 → kept as plain sum, not collapsed.
  'ITRK-C': { quantityDelivered: 85000, quantityReceive: 78000, outstandingQuantity: 15000 },
  'ITRK-D': { quantityDelivered: 45000, quantityReceive: 38000, outstandingQuantity: 55000 },
  'ITRK-E': { quantityDelivered: 42000, quantityReceive: 39000, outstandingQuantity: 58000 },
  'ITRK-F': { quantityDelivered: 450000, quantityReceive: 440000, outstandingQuantity: 50000 },
  'ITRK-G-FRC': { quantityDelivered: 50000, quantityReceive: 45000, outstandingQuantity: 55000 },
  'ITRK-G-LCO': { quantityDelivered: 50000, quantityReceive: 45000, outstandingQuantity: 50000 },
  // Open + WB delivery only (receive null) → Delivery uses WB; Receive stays on SAP (not 0).
  'ITRK-H': { quantityDelivered: 10000, quantityReceive: 49390, outstandingQuantity: 90000 },
};

/**
 * Expected pipeline-stage bucket for each PO under `buildTruckingStatusSummaryCombinedQuery`
 * (`sqlTruckingPagePipelineStageExpr`): GR Close always forces COMPLETED regardless of ETA/OS.
 */
export const TRUCKING_QTY_EXPECTED_STAGE: Record<string, 'PLANNED' | 'COMPLETED'> = {
  'ITRK-A': 'PLANNED',
  'ITRK-B': 'PLANNED',
  'ITRK-C': 'PLANNED',
  'ITRK-D': 'PLANNED',
  'ITRK-E': 'COMPLETED',
  'ITRK-F': 'COMPLETED',
  'ITRK-G-FRC': 'PLANNED',
  'ITRK-G-LCO': 'PLANNED',
  'ITRK-H': 'PLANNED',
};

export const TRUCKING_QTY_CONTRACT_QTY_KG: Record<string, number> = {
  'ITRK-A': 100000,
  'ITRK-B': 100000,
  'ITRK-C': 100000,
  'ITRK-D': 100000,
  'ITRK-E': 100000,
  'ITRK-F': 500000,
  'ITRK-G-FRC': 100000,
  'ITRK-G-LCO': 100000,
  'ITRK-H': 100000,
};

/**
 * Aggregate totals expected from the summary endpoint over the fixture date range
 * (`GET /api/trucking?summaryOnly=true&dateFrom=...&dateTo=...`), derived by summing
 * `TRUCKING_QTY_SUMMARY_EXPECTED` / `TRUCKING_QTY_CONTRACT_QTY_KG` over the PLANNED-stage POs
 * (A, B, C, D, G-FRC, G-LCO) and COMPLETED-stage POs (E, F) respectively.
 *
 * PLANNED contract qty: 100000 × 7 = 700000
 * PLANNED outstanding qty: 60000 + 30000 + 15000 + 55000 + 55000 + 50000 + 90000 = 355000
 * COMPLETED contract qty: 100000 (E) + 500000 (F) = 600000
 * Outstanding Qty strip (3rd Party only, all fixtures use source_type = '3rd Party'):
 *   LCO: A(60000) + B(30000) + C(15000) + D(55000) + G-LCO(50000) + H(90000) = 300000
 *   FRC: G-FRC(55000)
 */
export const TRUCKING_QTY_SUMMARY_TOTALS = {
  plannedContractQtyKg: 700000,
  completedContractQtyKg: 600000,
  plannedOutstandingQtyKg: 355000,
  inProgressOutstandingQtyKg: 0,
  unplannedOutstandingQtyKg: 0,
  outstandingQty: {
    totalKg: 355000,
    thirdParty: { frcKg: 55000, lcoKg: 300000 },
    interco: { frcKg: 0, lcoKg: 0 },
  },
};

export interface TruckingQtyFixtureIds {
  contractUuid: Record<string, string>;
  operationId: Record<string, string>;
}

interface ContractSpec {
  contractId: string;
  poNumber: string;
  incoterm: 'FRC' | 'LCO';
  quantityOrderedKg: number;
}

const CONTRACTS: ContractSpec[] = [
  { contractId: 'ITRK-A', poNumber: 'ITRK-A-PO', incoterm: 'LCO', quantityOrderedKg: 100000 },
  { contractId: 'ITRK-B', poNumber: 'ITRK-B-PO', incoterm: 'LCO', quantityOrderedKg: 100000 },
  { contractId: 'ITRK-C', poNumber: 'ITRK-C-PO', incoterm: 'LCO', quantityOrderedKg: 100000 },
  { contractId: 'ITRK-D', poNumber: 'ITRK-D-PO', incoterm: 'LCO', quantityOrderedKg: 100000 },
  { contractId: 'ITRK-E', poNumber: 'ITRK-E-PO', incoterm: 'LCO', quantityOrderedKg: 100000 },
  { contractId: 'ITRK-F', poNumber: 'ITRK-F-PO', incoterm: 'LCO', quantityOrderedKg: 500000 },
  { contractId: 'ITRK-G-FRC', poNumber: 'ITRK-G-FRC-PO', incoterm: 'FRC', quantityOrderedKg: 100000 },
  { contractId: 'ITRK-G-LCO', poNumber: 'ITRK-G-LCO-PO', incoterm: 'LCO', quantityOrderedKg: 100000 },
  { contractId: 'ITRK-H', poNumber: 'ITRK-H-PO', incoterm: 'LCO', quantityOrderedKg: 100000 },
];

async function cleanupTruckingQtyFixtures(): Promise<void> {
  await query(`
    DELETE FROM trucking_daily_actuals
    WHERE trucking_operation_id IN (
      SELECT t.id FROM trucking_operations t
      INNER JOIN contracts c ON c.id = t.contract_id
      WHERE c.contract_id LIKE 'ITRK-%'
    )
  `);
  await query(`
    DELETE FROM trucking_operations
    WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE 'ITRK-%')
  `);
  await query(`DELETE FROM sap_processed_data WHERE contract_number LIKE 'ITRK-%'`);
  // Scoped by a marker in `error_log` (not a real error) so this never touches
  // import rows created by other integration suites running in parallel against
  // the same shared Postgres test database.
  await query(`DELETE FROM sap_data_imports WHERE error_log = 'ITRK-FIXTURE'`);
  await query(`DELETE FROM contracts WHERE contract_id LIKE 'ITRK-%'`);
}

async function insertContract(spec: ContractSpec): Promise<string> {
  const res = await query(
    `INSERT INTO contracts (
       contract_id, po_number, buyer, supplier, product, quantity_ordered, unit, unit_price,
       contract_date, delivery_start_date, delivery_end_date, contract_value, currency, status,
       incoterm, source_type, transport_mode
     ) VALUES (
       $1, $2, 'ITRK Buyer', 'ITRK Supplier', 'CPO', $3, 'MT', 10,
       $4::date, $4::date, '2031-12-31', $3::numeric * 10, 'USD', 'Open',
       $5, '3rd Party', 'LAND'
     ) RETURNING id`,
    [spec.contractId, spec.poNumber, spec.quantityOrderedKg, TRUCKING_QTY_CONTRACT_DATE, spec.incoterm],
  );
  return res.rows[0].id as string;
}

async function insertSpdRow(params: {
  contractId: string;
  poNumber: string;
  stoNumber: string;
  incoterm: 'FRC' | 'LCO';
  grStatus: 'Open' | 'Close';
  deliveryQty: string;
  receiveQty: string;
  importId: string;
  createdAtOffset: string;
}): Promise<void> {
  const raw: Record<string, string> = {
    'Quantity Delivery Trucking': params.deliveryQty,
    'Quantity Receive': params.receiveQty,
  };
  if (params.incoterm === 'FRC') {
    raw['GR PO Status'] = params.grStatus;
  } else {
    raw['GR STO Status'] = params.grStatus;
  }
  const data = { raw };
  await query(
    `INSERT INTO sap_processed_data (
       import_id, contract_number, po_number, sto_number, incoterm, data, status, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6::jsonb, 'processed',
       NOW() - ${params.createdAtOffset}, NOW() - ${params.createdAtOffset}
     )`,
    [params.importId, params.contractId, params.poNumber, params.stoNumber, params.incoterm, JSON.stringify(data)],
  );
}

async function insertTruckingOperation(contractUuid: string): Promise<string> {
  const res = await query(
    `INSERT INTO trucking_operations (
       contract_id, location, loading_location, unloading_location, trucking_owner,
       eta_trucking_start_date, daily_deliverables
     ) VALUES (
       $1::uuid, 'ITRK Location', 'ITRK Loading', 'ITRK Unloading', 'ITRK Trucking Owner',
       $2::date, '[]'::jsonb
     ) RETURNING id`,
    [contractUuid, TRUCKING_QTY_CONTRACT_DATE],
  );
  return res.rows[0].id as string;
}

async function insertWbActual(params: {
  operationId: string;
  progressDate: string;
  deliveryKg: number;
  receiveKg: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO trucking_daily_actuals (
       trucking_operation_id, progress_date, quantity_kg, quantity_delivery_kg, quantity_receive_kg, source
     ) VALUES ($1::uuid, $2::date, $3::numeric, $3::numeric, $4::numeric, 'wb')`,
    [params.operationId, params.progressDate, params.deliveryKg, params.receiveKg],
  );
}

/**
 * Seed the 9 ITRK-* fixtures (deterministic, safe to re-run). Returns contract UUID and
 * trucking_operations UUID per contract_id key (e.g. `contractUuid['ITRK-A']`).
 */
export async function seedTruckingQtyFixtures(): Promise<TruckingQtyFixtureIds> {
  await cleanupTruckingQtyFixtures();

  const imp = await query(
    `INSERT INTO sap_data_imports (import_date, status, total_records, processed_records, error_log)
     VALUES (CURRENT_DATE, 'completed', 1, 1, 'ITRK-FIXTURE') RETURNING id`,
  );
  const importId = imp.rows[0].id as string;

  const contractUuid: Record<string, string> = {};
  const operationId: Record<string, string> = {};

  for (const spec of CONTRACTS) {
    contractUuid[spec.contractId] = await insertContract(spec);
    operationId[spec.contractId] = await insertTruckingOperation(contractUuid[spec.contractId]);
  }

  // ITRK-A: single STO, GR Open, no WB.
  await insertSpdRow({
    contractId: 'ITRK-A',
    poNumber: 'ITRK-A-PO',
    stoNumber: 'STO-A1',
    incoterm: 'LCO',
    grStatus: 'Open',
    deliveryQty: '40000',
    receiveQty: '35000',
    importId,
    createdAtOffset: "interval '1 minute'",
  });

  // ITRK-B: 2 STOs, GR Open, each looks like the full-PO qty repeated → dedup collapses to MAX.
  await insertSpdRow({
    contractId: 'ITRK-B',
    poNumber: 'ITRK-B-PO',
    stoNumber: 'STO-B1',
    incoterm: 'LCO',
    grStatus: 'Open',
    deliveryQty: '70000',
    receiveQty: '65000',
    importId,
    createdAtOffset: "interval '2 minutes'",
  });
  await insertSpdRow({
    contractId: 'ITRK-B',
    poNumber: 'ITRK-B-PO',
    stoNumber: 'STO-B2',
    incoterm: 'LCO',
    grStatus: 'Open',
    deliveryQty: '70000',
    receiveQty: '65000',
    importId,
    createdAtOffset: "interval '1 minute'",
  });

  // ITRK-C: 2 STOs, GR Open, legit split (Σ within 1.2× contract) → dedup keeps the plain sum.
  await insertSpdRow({
    contractId: 'ITRK-C',
    poNumber: 'ITRK-C-PO',
    stoNumber: 'STO-C1',
    incoterm: 'LCO',
    grStatus: 'Open',
    deliveryQty: '40000',
    receiveQty: '38000',
    importId,
    createdAtOffset: "interval '2 minutes'",
  });
  await insertSpdRow({
    contractId: 'ITRK-C',
    poNumber: 'ITRK-C-PO',
    stoNumber: 'STO-C2',
    incoterm: 'LCO',
    grStatus: 'Open',
    deliveryQty: '45000',
    receiveQty: '40000',
    importId,
    createdAtOffset: "interval '1 minute'",
  });

  // ITRK-D: GR Open + WB actuals present → resolved qty uses WB sum, SAP is ignored.
  await insertSpdRow({
    contractId: 'ITRK-D',
    poNumber: 'ITRK-D-PO',
    stoNumber: 'STO-D1',
    incoterm: 'LCO',
    grStatus: 'Open',
    deliveryQty: '99999',
    receiveQty: '99999',
    importId,
    createdAtOffset: "interval '1 minute'",
  });
  await insertWbActual({
    operationId: operationId['ITRK-D'],
    progressDate: '2031-06-16',
    deliveryKg: 20000,
    receiveKg: 18000,
  });
  await insertWbActual({
    operationId: operationId['ITRK-D'],
    progressDate: '2031-06-17',
    deliveryKg: 25000,
    receiveKg: 20000,
  });

  // ITRK-E: GR Closed, WB rows also present → resolved qty uses SAP regardless of WB.
  await insertSpdRow({
    contractId: 'ITRK-E',
    poNumber: 'ITRK-E-PO',
    stoNumber: 'STO-E1',
    incoterm: 'LCO',
    grStatus: 'Close',
    deliveryQty: '42000',
    receiveQty: '39000',
    importId,
    createdAtOffset: "interval '1 minute'",
  });
  await insertWbActual({
    operationId: operationId['ITRK-E'],
    progressDate: '2031-06-16',
    deliveryKg: 99999,
    receiveKg: 99999,
  });

  // ITRK-F: SAP value is MT-scale vs a large kg contract → *1000 normalization branch.
  await insertSpdRow({
    contractId: 'ITRK-F',
    poNumber: 'ITRK-F-PO',
    stoNumber: 'STO-F1',
    incoterm: 'LCO',
    grStatus: 'Close',
    deliveryQty: '450',
    receiveQty: '440',
    importId,
    createdAtOffset: "interval '1 minute'",
  });

  // ITRK-G-FRC / ITRK-G-LCO: identical delivered/receive, different incoterm →
  // outstanding must be contract - receive (FRC) vs contract - delivered (LCO).
  await insertSpdRow({
    contractId: 'ITRK-G-FRC',
    poNumber: 'ITRK-G-FRC-PO',
    stoNumber: 'STO-GFRC1',
    incoterm: 'FRC',
    grStatus: 'Open',
    deliveryQty: '50000',
    receiveQty: '45000',
    importId,
    createdAtOffset: "interval '1 minute'",
  });
  await insertSpdRow({
    contractId: 'ITRK-G-LCO',
    poNumber: 'ITRK-G-LCO-PO',
    stoNumber: 'STO-GLCO1',
    incoterm: 'LCO',
    grStatus: 'Open',
    deliveryQty: '50000',
    receiveQty: '45000',
    importId,
    createdAtOffset: "interval '1 minute'",
  });

  // ITRK-H: GR Open + WB delivery only (receive still null) → list Receive must stay SAP, not 0.
  await insertSpdRow({
    contractId: 'ITRK-H',
    poNumber: 'ITRK-H-PO',
    stoNumber: 'STO-H1',
    incoterm: 'LCO',
    grStatus: 'Open',
    deliveryQty: '40000',
    receiveQty: '49390',
    importId,
    createdAtOffset: "interval '1 minute'",
  });
  await insertWbActual({
    operationId: operationId['ITRK-H'],
    progressDate: '2031-06-16',
    deliveryKg: 10000,
    receiveKg: null,
  });

  return { contractUuid, operationId };
}
