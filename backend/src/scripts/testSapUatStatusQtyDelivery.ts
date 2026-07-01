/**
 * Integration test: SAP UAT status + quantity delivery alignment across API surfaces.
 * Run: npx ts-node src/scripts/testSapUatStatusQtyDelivery.ts
 */
import { query } from '../database/connection';

interface SapRow {
  contract_id: string;
  incoterm: string;
  transport: string;
  sto_type: string | null;
  gr_po: string | null;
  gr_sto: string | null;
  qty_trucking_raw: string | null;
  qty_vessel_raw: string | null;
}

function parseSapNum(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = Number(String(raw).replace(/,/g, '').replace(/\s+/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function norm(s: unknown): string {
  return String(s ?? '').trim().toUpperCase();
}

/** Expected import status per UAT matrix */
function expectedImportStatus(row: SapRow): string {
  const inc = norm(row.incoterm);
  if (inc === 'CIF' || inc === 'FRC') return String(row.gr_po ?? '').trim();
  if (inc === 'FOB' || inc === 'LCO') return String(row.gr_sto ?? row.gr_po ?? '').trim();
  return String(row.gr_po ?? row.gr_sto ?? '').trim();
}

/** Expected quantity delivery (kg) per UAT matrix */
function expectedQtyDeliveryKg(row: SapRow): number {
  const { resolveUatQuantityDeliveryTs } = require('../utils/sapIncotermMetrics') as typeof import('../utils/sapIncotermMetrics');
  return resolveUatQuantityDeliveryTs(
    row.incoterm,
    row.transport,
    parseSapNum(row.qty_trucking_raw),
    parseSapNum(row.qty_vessel_raw),
  );
}

async function fetchSapSamples(): Promise<SapRow[]> {
  const result = await query(`
    WITH latest AS (
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        spd.data,
        c.incoterm,
        COALESCE(c.transport_mode, spd.data->'raw'->>'Sea / Land', spd.data->'contract'->>'transport_mode', '') AS transport
      FROM sap_processed_data spd
      JOIN contracts c ON c.contract_id = spd.contract_number
      ORDER BY spd.contract_number, spd.created_at DESC
    )
    SELECT
      contract_number AS contract_id,
      incoterm,
      transport,
      NULLIF(TRIM(COALESCE(data->'raw'->>'STO Type', data->'raw'->>'STO_Type', data->'contract'->>'sto_type')), '') AS sto_type,
      data->'raw'->>'GR PO Status' AS gr_po,
      data->'raw'->>'GR STO Status' AS gr_sto,
      data->'raw'->>'Quantity Delivery Trucking' AS qty_trucking_raw,
      data->'raw'->>'Quantity Delivery Vessel' AS qty_vessel_raw
    FROM latest
    WHERE incoterm IN ('FRC','LCO','CIF','FOB')
      AND (
        (incoterm IN ('FRC','LCO') AND UPPER(TRIM(transport)) = 'LAND')
        OR (incoterm IN ('CIF','FOB') AND UPPER(TRIM(transport)) = 'SEA')
        OR (incoterm IN ('CIF','FOB') AND UPPER(TRIM(transport)) = 'MIX'
            AND NULLIF(TRIM(COALESCE(data->'raw'->>'STO Type', data->'contract'->>'sto_type')), '') IN ('T','V'))
        OR contract_number = '1004030657'
      )
    ORDER BY incoterm, transport, sto_type, contract_number
    LIMIT 40
  `);
  return result.rows as SapRow[];
}

async function loginToken(): Promise<string> {
  const base = process.env.API_BASE ?? 'http://localhost:5001';
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const json = (await res.json()) as { data?: { token?: string }; token?: string };
  const token = json.data?.token ?? json.token;
  if (!token) throw new Error('No token in login response');
  return token;
}

async function apiGet(path: string, token: string): Promise<unknown> {
  const base = process.env.API_BASE ?? 'http://localhost:5001';
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  const json = (await res.json()) as { data?: unknown };
  return json.data ?? json;
}

interface TestResult {
  contract_id: string;
  scenario: string;
  surface: string;
  field: string;
  expected: string | number;
  actual: string | number | null | undefined;
  pass: boolean;
}

async function main() {
  const samples = await fetchSapSamples();
  console.log(`Loaded ${samples.length} SAP sample rows\n`);

  let token: string | null = null;
  try {
    token = await loginToken();
    console.log('API login OK\n');
  } catch (e) {
    console.warn('API login failed — SQL-only checks:', e);
  }

  const results: TestResult[] = [];

  for (const row of samples) {
    const expStatus = expectedImportStatus(row);
    const expQty = expectedQtyDeliveryKg(row);
    const scenario = `${row.incoterm}_${row.transport}${row.sto_type ? `_STO${row.sto_type}` : ''}`;

    // SQL: incoterm-aware import status (canonical)
    const statusSql = await query(
      `SELECT ${(await import('../utils/contractDeliveryStatus')).sqlContractImportStatusExpr('c')} AS import_status
       FROM contracts c WHERE c.contract_id = $1 LIMIT 1`,
      [row.contract_id],
    );
    const sqlStatus = (statusSql.rows[0] as { import_status?: string })?.import_status;
    results.push({
      contract_id: row.contract_id,
      scenario,
      surface: 'SQL contractDeliveryStatus',
      field: 'import_status',
      expected: expStatus,
      actual: sqlStatus,
      pass: norm(sqlStatus) === norm(expStatus) || (!expStatus && !sqlStatus),
    });

    // SQL: qty_move + incoterm case (contracts list base)
    const qtySql = await query(
      `
      WITH contract_scope AS (SELECT $1::text AS contract_id),
      ${(await import('../utils/contractGlobalOutstandingSql')).buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' })}
      SELECT
        qm.quantity_delivery_trucking,
        qm.quantity_delivery_vessel,
        qm.quantity_delivery,
        ${(await import('../utils/sapIncotermMetrics')).sqlIncotermQuantityDeliveryCase(
          'c.incoterm',
          'qm.quantity_delivery_trucking',
          'qm.quantity_delivery_vessel',
          (await import('../utils/sapIncotermMetrics')).sqlTransportModeFromContractAndJson('c.transport_mode', `(SELECT l.data FROM sap_processed_data l WHERE l.contract_number = c.contract_id ORDER BY l.created_at DESC LIMIT 1)`),
        )} AS incoterm_qty
      FROM qty_move qm
      JOIN contracts c ON c.contract_id = qm.contract_number
      WHERE qm.contract_number = $1
      LIMIT 1
      `,
      [row.contract_id],
    );
    const qtyRow = qtySql.rows[0] as {
      quantity_delivery_trucking?: number;
      quantity_delivery_vessel?: number;
      quantity_delivery?: number;
      incoterm_qty?: number;
    } | undefined;
    const incotermQty = Number(qtyRow?.incoterm_qty ?? 0);
    results.push({
      contract_id: row.contract_id,
      scenario,
      surface: 'SQL qty_move incoterm case',
      field: 'quantity_delivery',
      expected: expQty,
      actual: incotermQty,
      pass: Math.abs(incotermQty - expQty) < 1,
    });

    if (!token) continue;

    // Contracts list API
    const contracts = (await apiGet(
      `/api/contracts?search=${encodeURIComponent(row.contract_id)}&limit=5`,
      token,
    )) as { contracts?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const list = Array.isArray(contracts) ? contracts : contracts.contracts ?? [];
    const cRow = list.find((c) => String(c.contract_id) === row.contract_id);
    if (cRow) {
      results.push({
        contract_id: row.contract_id,
        scenario,
        surface: 'GET /api/contracts (list)',
        field: 'import_status',
        expected: expStatus,
        actual: String(cRow.import_status ?? ''),
        pass: norm(cRow.import_status) === norm(expStatus) || (!expStatus && !cRow.import_status),
      });
      results.push({
        contract_id: row.contract_id,
        scenario,
        surface: 'GET /api/contracts (list)',
        field: 'quantity_delivery',
        expected: expQty,
        actual: Number(cRow.quantity_delivery ?? 0),
        pass: Math.abs(Number(cRow.quantity_delivery ?? 0) - expQty) < 1,
      });
    }

    // Trucking list (FRC/LCO only typically)
    if (row.incoterm === 'FRC' || row.incoterm === 'LCO') {
      const trucking = (await apiGet(
        `/api/trucking?search=${encodeURIComponent(row.contract_id)}&limit=5`,
        token,
      )) as { operations?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const tList = Array.isArray(trucking) ? trucking : trucking.operations ?? [];
      const tRow = tList.find((t) => String(t.contract_number ?? t.contract_id) === row.contract_id);
      if (tRow) {
        results.push({
          contract_id: row.contract_id,
          scenario,
          surface: 'GET /api/trucking (list)',
          field: 'contract_import_status',
          expected: expStatus,
          actual: String(tRow.contract_import_status ?? ''),
          pass: norm(tRow.contract_import_status) === norm(expStatus),
        });
      }
    }

    // Shipments list (CIF/FOB SEA/MIX)
    if (row.incoterm === 'CIF' || row.incoterm === 'FOB') {
      const shipments = (await apiGet(
        `/api/shipments?search=${encodeURIComponent(row.contract_id)}&limit=5`,
        token,
      )) as { shipments?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const sList = Array.isArray(shipments) ? shipments : shipments.shipments ?? [];
      const sRow = sList.find((s) => String(s.contract_number ?? s.contract_id) === row.contract_id);
      if (sRow && sRow.contract_import_status != null) {
        results.push({
          contract_id: row.contract_id,
          scenario,
          surface: 'GET /api/shipments (list)',
          field: 'contract_import_status',
          expected: expStatus,
          actual: String(sRow.contract_import_status ?? ''),
          pass: norm(sRow.contract_import_status) === norm(expStatus),
        });
      }
    }
  }

  const failed = results.filter((r) => !r.pass);
  const passed = results.filter((r) => r.pass);

  console.log('=== SAP UAT Status & Qty Delivery Test Report ===\n');
  console.log(`Total checks: ${results.length}`);
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}\n`);

  if (failed.length) {
    console.log('--- FAILURES ---');
    for (const f of failed) {
      console.log(
        `[FAIL] ${f.contract_id} (${f.scenario}) | ${f.surface} | ${f.field} | expected=${f.expected} actual=${f.actual}`,
      );
    }
  }

  // Group failures by surface
  const bySurface = new Map<string, number>();
  for (const f of failed) {
    bySurface.set(f.surface, (bySurface.get(f.surface) ?? 0) + 1);
  }
  if (bySurface.size) {
    console.log('\n--- Failures by surface ---');
    for (const [k, v] of bySurface) console.log(`  ${k}: ${v}`);
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
