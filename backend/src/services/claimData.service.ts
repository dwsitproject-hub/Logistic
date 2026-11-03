import type { PoolClient } from 'pg';
import { getClient, query } from '../database/connection';
import logger from '../utils/logger';
import type { ClaimDataKind, ClaimDataParseResult, ClaimDataRow } from '../utils/claimDataWorkbook';
import { normalizeClaimMutuCommodity, unitForDest } from '../utils/claimMutuWorkbook';

/**
 * Claim Data import: the OSCLAIM / REALCLAIM pair that feeds Shortage Claim and Quality Claim.
 *
 * - OS (outstanding) REPLACES the outstanding snapshot: every OS upload is a new import in both
 *   claim_susut_imports and claim_mutu_imports (source_kind = 'claim_data'), and the pages read the
 *   latest import. The realised rows already held are moved onto it, so the pages keep one import
 *   that carries both halves.
 * - Real (realised / paid) UPSERTS per CR number and is cumulative: a CR already held is replaced.
 * - SUSUT rows go to the claim_susut_* tables, MUTU rows to claim_mutu_*.
 * - B2B status (B2B / DIRECT / UNMATCHED) is read from the Logistics Report and refreshed daily, so
 *   it follows the SAP master rather than the day the claim was uploaded. OUTSTANDING DAYS is
 *   recomputed from CR date the same way.
 */

export interface ClaimDataImportResult {
  uploadId: string;
  kind: ClaimDataKind;
  totalRows: number;
  susutRows: number;
  mutuRows: number;
  insertedRows: number;
  replacedRows: number;
  failedRows: number;
  b2b: number;
  direct: number;
  unmatched: number;
  warnings: string[];
  errors: Array<{ rowIndex: number; message: string; sheet?: string }>;
}

type Exec = Pick<PoolClient, 'query'>;

const todayJakarta = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

const daysBetween = (fromIso: string | null, toIso: string): number | null => {
  if (!fromIso) return null;
  const d = Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(d) ? Math.max(0, d) : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tax as the file gives it, else the difference when both amounts are known. */
const taxOf = (r: ClaimDataRow): number | null => {
  if (r.tax != null) return r.tax;
  if (r.amountBeforeTax != null && r.amountAfterTax != null) return round2(r.amountAfterTax - r.amountBeforeTax);
  return null;
};

// ---------------------------------------------------------------------------------------------
// Column maps: each table's insert columns and the value of each for a parsed row.

interface TableSpec {
  table: string;
  columns: string[];
  /** Columns written as JSON. */
  json: string[];
  values: (r: ClaimDataRow, importId: string, today: string) => unknown[];
}

const SUSUT_OS: TableSpec = {
  table: 'claim_susut_rows',
  json: ['raw'],
  columns: [
    'import_id', 'vendor_code', 'vendor_name', 'vendor_type', 'created_by', 'sta', 'crno', 'cr_date', 'os_days',
    'group_of_transport', 'payment_method', 'dest', 'po_number', 'contract_ext_no', 'comm', 'commodity', 'uom',
    'currency', 'company_code', 'remarks', 'type', 'qty_claim', 'amount_before_tax_idr', 'tax',
    'amount_after_tax_idr', 'material_description', 'raw',
  ],
  values: (r, importId, today) => [
    importId, r.vendorCode, r.vendorName, r.vendorType, r.createdBy, r.sta, r.crNo, r.crDate,
    daysBetween(r.crDate, today) ?? r.osDaysFile,
    r.transportGroup, null, r.dest, r.poNumber, r.contractExtNo, r.comm, r.commodity, r.uom,
    r.currency, r.companyCode, r.keterangan, r.typeRaw, r.qty, r.amountBeforeTax, taxOf(r),
    r.amountAfterTax, r.materialDescription, JSON.stringify(r.raw),
  ],
};

const SUSUT_REAL: TableSpec = {
  table: 'claim_susut_real_rows',
  json: ['raw'],
  columns: [
    'import_id', 'vendor_code', 'vendor_name', 'cargo_source', 'cr_no', 'claim_date', 'cm_date', 'po_cn_date',
    'po_number', 'comm', 'commodity', 'material_description', 'dest', 'status_claim', 'company_code',
    'type_of_claim', 'currency', 'qty_approved', 'uom', 'amount_before_tax_idr', 'tax', 'amount_after_tax_idr',
    'remarks', 'transport_group', 'raw',
  ],
  values: (r, importId) => [
    importId, r.vendorCode, r.vendorName, r.cargoSource, r.crNo, r.crDate, r.cmDate, r.poCnDate,
    r.poNumber, r.comm, r.commodity, r.materialDescription, r.dest, r.sta, r.companyCode,
    r.typeRaw, r.currency, r.qty, r.uom, r.amountBeforeTax, taxOf(r), r.amountAfterTax,
    r.keterangan, r.transportGroup, JSON.stringify(r.raw),
  ],
};

const MUTU_OS: TableSpec = {
  table: 'claim_mutu_rows',
  json: ['raw'],
  columns: [
    'import_id', 'is_b2b',
    'vendor_code', 'vendor_name', 'group_name', 'group_of_vendor', 'vendor_type', 'cargo_source', 'keterangan',
    'metode_payment', 'claim_group', 'type_of_comp', 'traders', 'created_by', 'sta', 'crno', 'cr_date', 'os_days',
    'dest', 'unit', 'po_number', 'contract_ext_no', 'comm', 'product', 'material_description', 'company_code',
    'mutu_kontrak_ffa', 'mutu_kontrak_mi', 'mutu_kontrak_dns', 'mutu_kontrak_dobi',
    'mutu_klaim_ffa', 'mutu_klaim_mi', 'mutu_klaim_dns', 'mutu_klaim_dobi',
    'claim_type', 'qty_claim_kg', 'uom', 'amount_before_tax_idr', 'tax', 'amount_after_tax_idr', 'raw',
  ],
  values: (r, importId, today) => {
    const group = r.groupOfVendor || r.groupKey;
    return [
      importId, false,
      r.vendorCode, r.vendorName, group, group, r.vendorType, r.cargoSource, r.keterangan,
      // The new export has no METODE PAYMENT / GROUP columns: the Pivot's group falls back to VENDOR TYPE.
      null, r.vendorType ? r.vendorType.toUpperCase() : null, null, r.traders, r.createdBy, r.sta, r.crNo, r.crDate,
      daysBetween(r.crDate, today) ?? r.osDaysFile,
      r.dest, unitForDest(r.dest), r.poNumber, r.contractExtNo, r.comm,
      normalizeClaimMutuCommodity(r.commodity, r.materialDescription), r.materialDescription, r.companyCode,
      r.mutuKontrak.ffa, r.mutuKontrak.mi, r.mutuKontrak.dns, r.mutuKontrak.dobi,
      r.mutuKlaim.ffa, r.mutuKlaim.mi, r.mutuKlaim.dns, r.mutuKlaim.dobi,
      r.typeRaw, r.qty, r.uom, r.amountBeforeTax, taxOf(r), r.amountAfterTax, JSON.stringify(r.raw),
    ];
  },
};

const MUTU_REAL: TableSpec = {
  table: 'claim_mutu_real_rows',
  json: ['raw'],
  columns: [
    'import_id', 'is_b2b',
    'vendor_code', 'vendor_name', 'group_key', 'vendor_type', 'cargo_source', 'traders', 'kebun',
    'cr_no', 'claim_date', 'cm_no', 'cm_date', 'po_number', 'contract_ext_no', 'comm', 'commodity', 'material_description',
    'dest', 'unit', 'status_claim', 'company_code',
    'mutu_kontrak_ffa', 'mutu_kontrak_mi', 'mutu_kontrak_dns', 'mutu_kontrak_dobi',
    'mutu_klaim_ffa', 'mutu_klaim_mi', 'mutu_klaim_dns', 'mutu_klaim_dobi',
    'claim_type', 'qty_kg', 'uom', 'amount_before_tax_idr', 'tax', 'amount_after_tax_idr', 'raw',
  ],
  values: (r, importId) => [
    importId, false,
    r.vendorCode, r.vendorName, r.groupKey, r.vendorType, r.cargoSource, r.traders, r.kebun,
    r.crNo, r.crDate, r.cmNo, r.cmDate, r.poNumber, r.contractExtNo, r.comm,
    normalizeClaimMutuCommodity(r.commodity, r.materialDescription), r.materialDescription,
    r.dest, unitForDest(r.dest), r.sta, r.companyCode,
    r.mutuKontrak.ffa, r.mutuKontrak.mi, r.mutuKontrak.dns, r.mutuKontrak.dobi,
    r.mutuKlaim.ffa, r.mutuKlaim.mi, r.mutuKlaim.dns, r.mutuKlaim.dobi,
    r.typeRaw, r.qty, r.uom, r.amountBeforeTax, taxOf(r), r.amountAfterTax, JSON.stringify(r.raw),
  ],
};

const CHUNK = 150;

/**
 * Insert rows in chunks of one multi-row statement; a chunk the database refuses is retried row by
 * row, each under a SAVEPOINT, so one bad row is reported and the rest still go in.
 */
async function insertRows(
  client: Exec,
  spec: TableSpec,
  rows: ClaimDataRow[],
  importId: string,
  today: string,
  errors: ClaimDataImportResult['errors'],
): Promise<number> {
  const width = spec.columns.length;
  const placeholder = (base: number) =>
    `(${spec.columns
      .map((col, i) => `$${base + i + 1}${spec.json.includes(col) ? '::jsonb' : ''}`)
      .join(',')})`;
  const insertSql = (n: number) =>
    `INSERT INTO ${spec.table} (${spec.columns.join(',')}) VALUES ${Array.from({ length: n }, (_, k) => placeholder(k * width)).join(',')}`;

  let inserted = 0;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const values = chunk.flatMap((r) => spec.values(r, importId, today));
    await client.query('SAVEPOINT claim_chunk');
    try {
      await client.query(insertSql(chunk.length), values);
      await client.query('RELEASE SAVEPOINT claim_chunk');
      inserted += chunk.length;
      continue;
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT claim_chunk');
      await client.query('RELEASE SAVEPOINT claim_chunk');
    }
    for (const r of chunk) {
      await client.query('SAVEPOINT claim_row');
      try {
        await client.query(insertSql(1), spec.values(r, importId, today));
        await client.query('RELEASE SAVEPOINT claim_row');
        inserted++;
      } catch (e: any) {
        await client.query('ROLLBACK TO SAVEPOINT claim_row');
        errors.push({ rowIndex: r.sheetRow, sheet: r.sheetName, message: String(e?.message || e) });
      }
    }
  }
  return inserted;
}

// ---------------------------------------------------------------------------------------------
// Derived columns: B2B status and outstanding days

/**
 * B2B status per claim PO, read from the Logistics Report: contract_latest_spd_snapshot.b2b_flag_raw
 * (B2B / DIRECT, as is), falling back to contracts.contract_type like the shipment pages do. The
 * claim's PO is matched to contracts.po_number first, then to contracts.contract_id, then (OS only)
 * the contract ext no. A PO that no contract carries is UNMATCHED - never folded into DIRECT.
 * Origin POs of type B2B count as B2B; Reff PO is not used.
 */
const B2B_CTES = `
b2b_src AS (
  SELECT c.po_number AS po, c.contract_id AS cid,
         UPPER(NULLIF(TRIM(COALESCE(NULLIF(TRIM(s.b2b_flag_raw), ''), c.contract_type::text, '')), '')) AS flag
  FROM contracts c
  LEFT JOIN contract_latest_spd_snapshot s ON s.contract_number = c.contract_id
),
b2b_po AS (
  SELECT UPPER(TRIM(po)) AS k,
         CASE WHEN bool_or(flag = 'B2B') THEN 'B2B' WHEN bool_or(flag = 'DIRECT') THEN 'DIRECT' END AS st
  FROM b2b_src WHERE NULLIF(TRIM(po), '') IS NOT NULL GROUP BY 1
),
b2b_cid AS (
  SELECT UPPER(TRIM(cid)) AS k,
         CASE WHEN bool_or(flag = 'B2B') THEN 'B2B' WHEN bool_or(flag = 'DIRECT') THEN 'DIRECT' END AS st
  FROM b2b_src WHERE NULLIF(TRIM(cid), '') IS NOT NULL GROUP BY 1
)`;

const DERIVED_TABLES = [
  { table: 'claim_susut_rows', imports: 'claim_susut_imports', ext: true, mutu: false, os: true },
  { table: 'claim_susut_real_rows', imports: 'claim_susut_imports', ext: false, mutu: false, os: false },
  { table: 'claim_mutu_rows', imports: 'claim_mutu_imports', ext: true, mutu: true, os: true },
  { table: 'claim_mutu_real_rows', imports: 'claim_mutu_imports', ext: false, mutu: true, os: false },
] as const;

/** Refresh b2b_status (and is_b2b on Mutu) and OUTSTANDING DAYS on every claim_data row. */
export async function refreshClaimDataDerived(exec: Exec = { query } as Exec): Promise<void> {
  for (const t of DERIVED_TABLES) {
    await exec.query(
      `WITH ${B2B_CTES},
x AS (
  SELECT r.id, COALESCE(bp.st, bc.st, ${t.ext ? 'be.st, ' : ''}'UNMATCHED') AS st
  FROM ${t.table} r
  JOIN ${t.imports} i ON i.id = r.import_id AND i.source_kind = 'claim_data'
  LEFT JOIN b2b_po bp ON bp.k = UPPER(NULLIF(TRIM(r.po_number), ''))
  LEFT JOIN b2b_cid bc ON bc.k = UPPER(NULLIF(TRIM(r.po_number), ''))
  ${t.ext ? "LEFT JOIN b2b_cid be ON be.k = UPPER(NULLIF(TRIM(r.contract_ext_no), ''))" : ''}
)
UPDATE ${t.table} r
   SET b2b_status = x.st${t.mutu ? ", is_b2b = (x.st = 'B2B')" : ''}
  FROM x
 WHERE r.id = x.id
   AND (r.b2b_status IS DISTINCT FROM x.st${t.mutu ? " OR r.is_b2b IS DISTINCT FROM (x.st = 'B2B')" : ''})`,
    );
    if (t.os) {
      await exec.query(
        `UPDATE ${t.table} r
            SET os_days = GREATEST(0, ((NOW() AT TIME ZONE 'Asia/Jakarta')::date - r.cr_date))::int
           FROM ${t.imports} i
          WHERE i.id = r.import_id AND i.source_kind = 'claim_data' AND r.cr_date IS NOT NULL
            AND r.os_days IS DISTINCT FROM GREATEST(0, ((NOW() AT TIME ZONE 'Asia/Jakarta')::date - r.cr_date))::int`,
      );
    }
  }
}

export async function refreshClaimDataDerivedSafe(): Promise<void> {
  try {
    await refreshClaimDataDerived();
    logger.info('Claim Data B2B status / outstanding days refreshed');
  } catch (error) {
    logger.error('Claim Data refresh failed:', error);
  }
}

// ---------------------------------------------------------------------------------------------
// Import

async function newImport(
  client: Exec,
  table: 'claim_susut_imports' | 'claim_mutu_imports',
  args: { fileName: string; userId: string | null; dataAsOf: string | null; warnings: string[]; sheetLabel: string },
): Promise<string> {
  const withWarnings = table === 'claim_mutu_imports';
  const res = await client.query(
    `INSERT INTO ${table}
       (file_name, sheet_name, uploaded_by, total_rows, inserted_rows, errors, source_kind, data_as_of${withWarnings ? ', warnings' : ''})
     VALUES ($1, $2, $3, 0, 0, '[]'::jsonb, 'claim_data', $4::date${withWarnings ? ', $5::jsonb' : ''})
     RETURNING id`,
    withWarnings
      ? [args.fileName, args.sheetLabel, args.userId, args.dataAsOf, JSON.stringify(args.warnings)]
      : [args.fileName, args.sheetLabel, args.userId, args.dataAsOf],
  );
  return res.rows[0].id as string;
}

async function latestClaimDataImport(
  client: Exec,
  table: 'claim_susut_imports' | 'claim_mutu_imports',
): Promise<string | null> {
  const res = await client.query(
    `SELECT id FROM ${table} WHERE source_kind = 'claim_data' ORDER BY uploaded_at DESC NULLS LAST LIMIT 1`,
  );
  return (res.rows[0]?.id as string | undefined) ?? null;
}

/** The pages tell whether realised data exists from the active import's real_* columns; keep them true. */
async function syncRealCounts(client: Exec, rows: string, imports: string, importId: string): Promise<void> {
  await client.query(
    `UPDATE ${imports} SET
        real_total_rows = c.n,
        real_inserted_rows = c.n,
        real_sheet_name = CASE WHEN c.n > 0 THEN 'REALCLAIM' ELSE NULL END
       FROM (SELECT COUNT(*)::int AS n FROM ${rows} WHERE import_id = $1) c
      WHERE ${imports}.id = $1`,
    [importId],
  );
}

export async function importClaimData(args: {
  kind: ClaimDataKind;
  fileName: string;
  userId: string | null;
  dataAsOf: string | null;
  parsed: ClaimDataParseResult;
}): Promise<ClaimDataImportResult> {
  const { kind, fileName, userId, dataAsOf, parsed } = args;
  const today = todayJakarta();
  const warnings = [...parsed.warnings];
  const errors: ClaimDataImportResult['errors'] = [];
  const susutErrors: ClaimDataImportResult['errors'] = [];
  const mutuErrors: ClaimDataImportResult['errors'] = [];
  const susut = parsed.rows.filter((r) => r.claimType === 'SUSUT');
  const mutu = parsed.rows.filter((r) => r.claimType === 'MUTU');
  const label = kind === 'os' ? 'OSCLAIM' : 'REALCLAIM';

  const client = await getClient();
  try {
    await client.query('BEGIN');
    let susutImportId: string;
    let mutuImportId: string;
    let replaced = 0;
    let inserted = 0;

    if (kind === 'os') {
      susutImportId = await newImport(client, 'claim_susut_imports', { fileName, userId, dataAsOf, warnings, sheetLabel: label });
      mutuImportId = await newImport(client, 'claim_mutu_imports', { fileName, userId, dataAsOf, warnings, sheetLabel: label });
      // The realised rows already held follow the newest import.
      await client.query(
        `UPDATE claim_susut_real_rows SET import_id = $1
          WHERE import_id <> $1 AND import_id IN (SELECT id FROM claim_susut_imports WHERE source_kind = 'claim_data')`,
        [susutImportId],
      );
      await client.query(
        `UPDATE claim_mutu_real_rows SET import_id = $1
          WHERE import_id <> $1 AND import_id IN (SELECT id FROM claim_mutu_imports WHERE source_kind = 'claim_data')`,
        [mutuImportId],
      );
      await syncRealCounts(client, 'claim_susut_real_rows', 'claim_susut_imports', susutImportId);
      await syncRealCounts(client, 'claim_mutu_real_rows', 'claim_mutu_imports', mutuImportId);
      inserted += await insertRows(client, SUSUT_OS, susut, susutImportId, today, susutErrors);
      inserted += await insertRows(client, MUTU_OS, mutu, mutuImportId, today, mutuErrors);
    } else {
      susutImportId =
        (await latestClaimDataImport(client, 'claim_susut_imports')) ??
        (await newImport(client, 'claim_susut_imports', { fileName, userId, dataAsOf, warnings: [], sheetLabel: label }));
      mutuImportId =
        (await latestClaimDataImport(client, 'claim_mutu_imports')) ??
        (await newImport(client, 'claim_mutu_imports', { fileName, userId, dataAsOf, warnings: [], sheetLabel: label }));
      // Upsert per CR number: drop what is held under the same CR, then insert the new rows.
      const del = async (table: string, imports: string, crNos: string[]) => {
        if (crNos.length === 0) return 0;
        const res = await client.query(
          `DELETE FROM ${table}
            WHERE cr_no = ANY($1::text[])
              AND import_id IN (SELECT id FROM ${imports} WHERE source_kind = 'claim_data')`,
          [crNos],
        );
        return res.rowCount ?? 0;
      };
      // A CR is one claim: if its type changed between uploads it must not survive on the other side.
      const allCr = parsed.rows.map((r) => r.crNo);
      replaced += await del('claim_susut_real_rows', 'claim_susut_imports', allCr);
      replaced += await del('claim_mutu_real_rows', 'claim_mutu_imports', allCr);
      inserted += await insertRows(client, SUSUT_REAL, susut, susutImportId, today, susutErrors);
      inserted += await insertRows(client, MUTU_REAL, mutu, mutuImportId, today, mutuErrors);
      errors.push(...susutErrors, ...mutuErrors);
      await syncRealCounts(client, 'claim_susut_real_rows', 'claim_susut_imports', susutImportId);
      await syncRealCounts(client, 'claim_mutu_real_rows', 'claim_mutu_imports', mutuImportId);
    }

    if (kind === 'os') {
      errors.push(...susutErrors, ...mutuErrors);
      await client.query(
        `UPDATE claim_susut_imports SET total_rows = $2, inserted_rows = $3, errors = $4::jsonb WHERE id = $1`,
        [susutImportId, susut.length, susut.length - susutErrors.length, JSON.stringify(susutErrors)],
      );
      await client.query(
        `UPDATE claim_mutu_imports SET total_rows = $2, inserted_rows = $3, errors = $4::jsonb WHERE id = $1`,
        [mutuImportId, mutu.length, mutu.length - mutuErrors.length, JSON.stringify(mutuErrors)],
      );
    }

    await refreshClaimDataDerived(client);

    // B2B split of what this upload put in.
    const crNos = parsed.rows.map((r) => r.crNo);
    const tables =
      kind === 'os'
        ? [
            { sql: 'SELECT b2b_status, COUNT(*)::int AS n FROM claim_susut_rows WHERE import_id = $1 GROUP BY 1', p: [susutImportId] },
            { sql: 'SELECT b2b_status, COUNT(*)::int AS n FROM claim_mutu_rows WHERE import_id = $1 GROUP BY 1', p: [mutuImportId] },
          ]
        : [
            { sql: 'SELECT b2b_status, COUNT(*)::int AS n FROM claim_susut_real_rows WHERE import_id = $1 AND cr_no = ANY($2::text[]) GROUP BY 1', p: [susutImportId, crNos] },
            { sql: 'SELECT b2b_status, COUNT(*)::int AS n FROM claim_mutu_real_rows WHERE import_id = $1 AND cr_no = ANY($2::text[]) GROUP BY 1', p: [mutuImportId, crNos] },
          ];
    const split = { B2B: 0, DIRECT: 0, UNMATCHED: 0 } as Record<string, number>;
    for (const t of tables) {
      const res = await client.query(t.sql, t.p);
      for (const row of res.rows) split[String(row.b2b_status ?? 'UNMATCHED')] = (split[String(row.b2b_status ?? 'UNMATCHED')] ?? 0) + row.n;
    }
    if (split.UNMATCHED > 0 && parsed.rows.length > 0) {
      const pct = Math.round((split.UNMATCHED / parsed.rows.length) * 100);
      warnings.push(
        `${split.UNMATCHED} claim(s) (${pct}%) have a PO that is not in the Logistics Report, so their B2B status is Unmatched.`,
      );
    }
    if (errors.length > 0) warnings.push(`${errors.length} row(s) could not be saved.`);

    const up = await client.query(
      `INSERT INTO claim_data_uploads
         (kind, file_name, data_as_of, uploaded_by, susut_import_id, mutu_import_id,
          total_rows, susut_rows, mutu_rows, inserted_rows, replaced_rows, failed_rows,
          b2b_rows, direct_rows, unmatched_rows, total_qty, total_amount_idr, warnings, errors)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb)
       RETURNING id`,
      [
        kind, fileName, dataAsOf, userId, susutImportId, mutuImportId,
        parsed.rows.length, susut.length, mutu.length, inserted, replaced, errors.length,
        split.B2B, split.DIRECT, split.UNMATCHED,
        parsed.rowTotals.qty, parsed.rowTotals.amountAfterTax,
        JSON.stringify(warnings), JSON.stringify(errors.slice(0, 200)),
      ],
    );
    await client.query('COMMIT');

    return {
      uploadId: up.rows[0].id,
      kind,
      totalRows: parsed.rows.length,
      susutRows: susut.length,
      mutuRows: mutu.length,
      insertedRows: inserted,
      replacedRows: replaced,
      failedRows: errors.length,
      b2b: split.B2B,
      direct: split.DIRECT,
      unmatched: split.UNMATCHED,
      warnings,
      errors,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
