import { Response } from 'express';
import * as XLSX from 'xlsx';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';
import {
  findClaimMutuSheets,
  markB2bByExclusion,
  osMatchKey,
  parseClaimMutuOsSheet,
  parseClaimMutuRealSheet,
  periodMonthFromLabel,
  realMatchKey,
  unmatchedExcludeCount,
  CLAIM_MUTU_DEST_UNITS,
  type ClaimMutuOsRow,
  type ClaimMutuRealRow,
} from '../utils/claimMutuWorkbook';
import {
  buildClaimMutuSideCte,
  CLAIM_MUTU_AGING_SQL,
  parseClaimMutuFilters,
  type ClaimMutuFilters,
} from '../utils/claimMutuQuerySql';

/**
 * Claim Mutu (quality claims), fed by the monthly SAP workbook.
 *
 * OS (outstanding) is the main data and is mandatory; Real (realised in the period) is read when
 * the workbook has it. Both come twice - Include and Exclude B2B - and KLIP stores the Include rows
 * with each marked B2B when the Exclude sheet does not hold it (utils/claimMutuWorkbook.ts). Every
 * summary on the page is recomputed from those rows; the workbook's own summary sheets are not
 * imported.
 */

type OsSource = 'inc+exc' | 'inc-only' | 'exc-only' | 'legacy';

class ClaimMutuUploadError extends Error {}

const filtersOf = (req: AuthRequest): ClaimMutuFilters =>
  parseClaimMutuFilters((req.query || {}) as Record<string, unknown>);

// ---------------------------------------------------------------------------------------------
// Upload

export const uploadClaimMutuExcel = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, error: { message: 'File is required' } });

    const wb = XLSX.readFile(file.path, { cellDates: true });
    const sheets = findClaimMutuSheets(wb.SheetNames);
    const warnings: string[] = [];

    // ---- OS: mandatory
    const parseOs = (name: string) => {
      const parsed = parseClaimMutuOsSheet(wb.Sheets[name]);
      if (parsed.missing.length) {
        throw new ClaimMutuUploadError(`Missing required columns in ${name}: ${parsed.missing.join(', ')}`);
      }
      return parsed;
    };
    let osRows: Array<ClaimMutuOsRow & { isB2b: boolean }>;
    let osSource: OsSource;
    let osSheetLabel: string;
    let osPeriodLabel: string | null;
    if (sheets.osInc && sheets.osExc) {
      const inc = parseOs(sheets.osInc);
      const exc = parseOs(sheets.osExc);
      osRows = markB2bByExclusion(inc.rows, exc.rows, osMatchKey);
      const stray = unmatchedExcludeCount(inc.rows, exc.rows, osMatchKey);
      if (stray > 0) warnings.push(`${stray} row(s) in ${sheets.osExc} are not in ${sheets.osInc}; they were not imported.`);
      osSource = 'inc+exc';
      osSheetLabel = `${sheets.osInc} + ${sheets.osExc}`;
      osPeriodLabel = inc.periodLabel ?? exc.periodLabel;
    } else if (sheets.osInc || sheets.osExc || sheets.osLegacy) {
      const name = (sheets.osInc || sheets.osExc || sheets.osLegacy) as string;
      const parsed = parseOs(name);
      osRows = parsed.rows.map((r) => ({ ...r, isB2b: false }));
      osSource = sheets.osInc ? 'inc-only' : sheets.osExc ? 'exc-only' : 'legacy';
      osSheetLabel = name;
      osPeriodLabel = parsed.periodLabel;
      warnings.push(
        osSource === 'inc-only'
          ? 'No OS_Claim_Exc_B2B sheet: B2B rows cannot be told apart, so "Exclude B2B" shows every row of this file.'
          : osSource === 'exc-only'
            ? 'No OS_Claim_Inc_B2B sheet: this file holds no B2B rows, so "Include B2B" equals "Exclude B2B".'
            : `Old single-sheet layout (${name}): B2B rows cannot be told apart.`,
      );
    } else {
      return res.status(400).json({
        success: false,
        error: {
          message: `No OS claim sheet found (expected OS_Claim_Inc_B2B and OS_Claim_Exc_B2B). Sheets in this file: ${
            wb.SheetNames.join(', ') || '(none)'
          }`,
        },
      });
    }

    // ---- Real: optional, never blocks the OS import
    const realInc = sheets.realInc ? parseClaimMutuRealSheet(wb.Sheets[sheets.realInc]) : null;
    const realExc = sheets.realExc ? parseClaimMutuRealSheet(wb.Sheets[sheets.realExc]) : null;
    const realOk = (x: typeof realInc) => Boolean(x && x.missing.length === 0);
    if (realInc && !realOk(realInc)) warnings.push(`${sheets.realInc} was not imported - missing columns: ${realInc.missing.join(', ')}`);
    if (realExc && !realOk(realExc)) warnings.push(`${sheets.realExc} was not imported - missing columns: ${realExc.missing.join(', ')}`);
    let realRows: Array<ClaimMutuRealRow & { isB2b: boolean }> = [];
    let realSheetLabel: string | null = null;
    let realPeriodLabel: string | null = null;
    if (realOk(realInc) && realOk(realExc)) {
      realRows = markB2bByExclusion(realInc!.rows, realExc!.rows, realMatchKey);
      const stray = unmatchedExcludeCount(realInc!.rows, realExc!.rows, realMatchKey);
      if (stray > 0) warnings.push(`${stray} row(s) in ${sheets.realExc} are not in ${sheets.realInc}; they were not imported.`);
      realSheetLabel = `${sheets.realInc} + ${sheets.realExc}`;
      realPeriodLabel = realInc!.periodLabel ?? realExc!.periodLabel;
    } else if (realOk(realInc) || realOk(realExc)) {
      const only = (realOk(realInc) ? realInc : realExc)!;
      realRows = only.rows.map((r) => ({ ...r, isB2b: false }));
      realSheetLabel = (realOk(realInc) ? sheets.realInc : sheets.realExc) as string;
      realPeriodLabel = only.periodLabel;
    }

    const unmapped = [
      ...new Set(
        [...osRows, ...realRows]
          .map((r) => r.dest)
          .filter((d): d is string => Boolean(d) && !CLAIM_MUTU_DEST_UNITS[String(d).toUpperCase()]),
      ),
    ];
    if (unmapped.length) warnings.push(`DEST code(s) with no unit mapping, shown as the code: ${unmapped.join(', ')}`);

    const imp = await query(
      `INSERT INTO claim_mutu_imports
         (file_name, sheet_name, uploaded_by, total_rows, inserted_rows, errors,
          os_period_label, period_month, b2b_source, real_sheet_name, real_period_label, warnings)
       VALUES ($1, $2, $3, 0, 0, '[]'::jsonb, $4, $5::date, $6, $7, $8, $9::jsonb)
       RETURNING id`,
      [
        file.originalname,
        osSheetLabel,
        req.user?.id ?? null,
        osPeriodLabel,
        periodMonthFromLabel(osPeriodLabel),
        osSource,
        realSheetLabel,
        realPeriodLabel,
        JSON.stringify(warnings),
      ],
    );
    const importId = imp.rows[0].id;

    const errors: Array<{ rowIndex: number; message: string; sheet?: string }> = [];
    let inserted = 0;
    for (const r of osRows) {
      try {
        await query(
          `INSERT INTO claim_mutu_rows (
             import_id, is_b2b,
             vendor_code, vendor_name, group_name, group_of_vendor, vendor_type, cargo_source, keterangan,
             metode_payment, claim_group, type_of_comp, traders, created_by, sta, crno, cr_date, os_days,
             dest, unit, po_number, contract_ext_no, comm, product, material_description, company_code,
             mutu_kontrak_ffa, mutu_kontrak_mi, mutu_kontrak_dns, mutu_kontrak_dobi,
             mutu_klaim_ffa, mutu_klaim_mi, mutu_klaim_dns, mutu_klaim_dobi,
             claim_type, qty_claim_kg, uom, amount_before_tax_idr, tax, amount_after_tax_idr, raw
           ) VALUES (
             $1, $2,
             $3, $4, $5, $5, $6, $7, $8,
             $9, $10, $11, $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23, $24, $25,
             $26, $27, $28, $29,
             $30, $31, $32, $33,
             $34, $35, $36, $37, $38, $39, $40::jsonb
           )`,
          [
            importId, r.isB2b,
            r.vendorCode, r.vendorName, r.groupOfVendor, r.vendorType, r.cargoSource, r.keterangan,
            r.metodePayment, r.claimGroup, r.typeOfComp, r.traders, r.createdBy, r.sta, r.crNo, r.crDate, r.osDays,
            r.dest, r.unit, r.poNumber, r.contractExtNo, r.comm, r.commodity, r.materialDescription, r.companyCode,
            r.mutuKontrak.ffa, r.mutuKontrak.mi, r.mutuKontrak.dns, r.mutuKontrak.dobi,
            r.mutuKlaim.ffa, r.mutuKlaim.mi, r.mutuKlaim.dns, r.mutuKlaim.dobi,
            r.claimType, r.qtyKg, r.uom, r.amountBeforeTax, r.tax, r.amountAfterTax, JSON.stringify(r.raw),
          ],
        );
        inserted++;
      } catch (e: any) {
        errors.push({ rowIndex: r.sheetRow, sheet: osSheetLabel, message: String(e?.message || e) });
      }
    }

    let realInserted = 0;
    for (const r of realRows) {
      try {
        await query(
          `INSERT INTO claim_mutu_real_rows (
             import_id, is_b2b,
             vendor_code, vendor_name, group_key, vendor_type, cargo_source, traders, kebun,
             cr_no, claim_date, cm_no, cm_date, po_number, contract_ext_no, comm, commodity, material_description,
             dest, unit, status_claim, company_code,
             mutu_kontrak_ffa, mutu_kontrak_mi, mutu_kontrak_dns, mutu_kontrak_dobi,
             mutu_klaim_ffa, mutu_klaim_mi, mutu_klaim_dns, mutu_klaim_dobi,
             claim_type, qty_kg, uom, amount_before_tax_idr, tax, amount_after_tax_idr, raw
           ) VALUES (
             $1, $2,
             $3, $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19, $20, $21, $22,
             $23, $24, $25, $26,
             $27, $28, $29, $30,
             $31, $32, $33, $34, $35, $36, $37::jsonb
           )`,
          [
            importId, r.isB2b,
            r.vendorCode, r.vendorName, r.groupKey, r.vendorType, r.cargoSource, r.traders, r.kebun,
            r.crNo, r.claimDate, r.cmNo, r.cmDate, r.poNumber, r.contractExtNo, r.comm, r.commodity, r.materialDescription,
            r.dest, r.unit, r.statusClaim, r.companyCode,
            r.mutuKontrak.ffa, r.mutuKontrak.mi, r.mutuKontrak.dns, r.mutuKontrak.dobi,
            r.mutuKlaim.ffa, r.mutuKlaim.mi, r.mutuKlaim.dns, r.mutuKlaim.dobi,
            r.claimType, r.qtyKg, r.uom, r.amountBeforeTax, r.tax, r.amountAfterTax, JSON.stringify(r.raw),
          ],
        );
        realInserted++;
      } catch (e: any) {
        errors.push({ rowIndex: r.sheetRow, sheet: realSheetLabel ?? undefined, message: String(e?.message || e) });
      }
    }

    await query(
      `UPDATE claim_mutu_imports
          SET total_rows = $2, inserted_rows = $3, errors = $4::jsonb,
              real_total_rows = $5, real_inserted_rows = $6
        WHERE id = $1`,
      [importId, osRows.length, inserted, JSON.stringify(errors), realRows.length, realInserted],
    );

    return res.json({
      success: true,
      data: {
        importId,
        sheetName: osSheetLabel,
        periodLabel: osPeriodLabel,
        b2bSource: osSource,
        totalRows: osRows.length,
        insertedRows: inserted,
        b2bRows: osRows.filter((r) => r.isB2b).length,
        failedRows: errors.length,
        errorCount: errors.length,
        errors,
        realSheetName: realSheetLabel,
        realPeriodLabel,
        realTotalRows: realRows.length,
        realInsertedRows: realInserted,
        realB2bRows: realRows.filter((r) => r.isB2b).length,
        warnings,
      },
    });
  } catch (error) {
    if (error instanceof ClaimMutuUploadError) {
      return res.status(400).json({ success: false, error: { message: error.message } });
    }
    logger.error('Claim Mutu upload/import failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to import Claim Mutu excel' } });
  }
};

// ---------------------------------------------------------------------------------------------
// Imports

export const listClaimMutuImports = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT i.id, i.file_name, i.sheet_name, i.uploaded_at, i.total_rows, i.inserted_rows, i.errors,
              i.os_period_label, i.period_month::text, i.b2b_source, i.real_sheet_name, i.real_period_label,
              i.real_total_rows, i.real_inserted_rows, i.warnings,
              u.full_name AS uploaded_by_name, u.username AS uploaded_by_username
         FROM claim_mutu_imports i
         LEFT JOIN users u ON u.id = i.uploaded_by
        ORDER BY i.uploaded_at DESC
        LIMIT 50`,
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('List Claim Mutu imports failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Mutu imports' } });
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One import with its failed rows, for the Import History detail view. */
export const getClaimMutuImportById = async (req: AuthRequest, res: Response) => {
  try {
    const id = String((req.params as { id?: string })?.id ?? '').trim();
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid import id' } });
    }
    const result = await query(
      `SELECT i.id, i.file_name, i.sheet_name, i.uploaded_at, i.total_rows, i.inserted_rows, i.errors,
              i.os_period_label, i.b2b_source, i.real_sheet_name, i.real_period_label,
              i.real_total_rows, i.real_inserted_rows, i.warnings,
              (SELECT COUNT(*)::int FROM claim_mutu_rows r WHERE r.import_id = i.id AND r.is_b2b) AS b2b_rows,
              u.full_name AS uploaded_by_name, u.username AS uploaded_by_username
         FROM claim_mutu_imports i
         LEFT JOIN users u ON u.id = i.uploaded_by
        WHERE i.id = $1::uuid`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ success: false, error: { message: 'Claim Mutu import not found' } });
    const errors = Array.isArray(row.errors) ? row.errors : [];
    const totalRows = Number(row.total_rows) || 0;
    const insertedRows = Number(row.inserted_rows) || 0;
    return res.json({
      success: true,
      data: {
        ...row,
        errors,
        failedRows: errors.length,
        successRate:
          totalRows > 0 ? Number(((insertedRows / totalRows) * 100).toFixed(1)) : insertedRows > 0 ? 100 : 0,
      },
    });
  } catch (error) {
    logger.error('Get Claim Mutu import failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Mutu import' } });
  }
};

// ---------------------------------------------------------------------------------------------
// Section 1

type Pair = { os_qty: number; os_amount: number; real_qty: number; real_amount: number };

function mergeSides<K extends string>(
  osRows: any[],
  realRows: any[],
  keyOf: (r: any) => string,
  base: (r: any) => Record<K, string>,
): Array<Record<K, string> & Pair> {
  const m = new Map<string, Record<K, string> & Pair>();
  const get = (r: any) => {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, { ...base(r), os_qty: 0, os_amount: 0, real_qty: 0, real_amount: 0 });
    return m.get(k)!;
  };
  for (const r of osRows) {
    const x = get(r);
    x.os_qty += Number(r.qty) || 0;
    x.os_amount += Number(r.amount) || 0;
  }
  for (const r of realRows) {
    const x = get(r);
    x.real_qty += Number(r.qty) || 0;
    x.real_amount += Number(r.amount) || 0;
  }
  return [...m.values()];
}

/**
 * Everything Section 1 shows, from one filter definition - three of the workbook's summary sheets,
 * recomputed: the Pivot (OS amount per GROUP x aging), Summary Per Komoditi (OS & Real per
 * commodity x unit) and Rekap Per Lokasi (OS & Real per DEST code). The Summary Per Unit trend is
 * its own endpoint because it spans imports.
 */
export const getClaimMutuDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const f = filtersOf(req);
    const os = buildClaimMutuSideCte('os', f);
    const real = buildClaimMutuSideCte('real', f);
    const byCommodityUnit = `SELECT commodity_norm AS commodity, unit_norm AS unit,
                COALESCE(SUM(qty),0)::float8 AS qty, COALESCE(SUM(amount),0)::float8 AS amount`;
    const byLocation = `SELECT dest_norm AS dest, MAX(unit_norm) AS unit,
                COALESCE(SUM(qty),0)::float8 AS qty, COALESCE(SUM(amount),0)::float8 AS amount`;

    const [imp, osTotals, aging, osByCu, osByLoc, realTotals, realByCu, realByLoc] = await Promise.all([
      query(
        `SELECT id, os_period_label, real_period_label, period_month::text, b2b_source, real_sheet_name, warnings
           FROM claim_mutu_imports
          WHERE ($1::uuid IS NULL OR id = $1::uuid)
          ORDER BY CASE WHEN $1::uuid IS NOT NULL THEN 0 ELSE 1 END, uploaded_at DESC NULLS LAST
          LIMIT 1`,
        [f.importId],
      ),
      query(
        `WITH ${os.sql}
         SELECT COUNT(*)::int AS claims, COALESCE(SUM(qty),0)::float8 AS qty, COALESCE(SUM(amount),0)::float8 AS amount,
                COALESCE(SUM(CASE WHEN os_days > 90 THEN amount END),0)::float8 AS over90
           FROM os`,
        os.params,
      ),
      query(
        `WITH ${os.sql}
         SELECT COALESCE(NULLIF(TRIM(claim_group),''),'(Blank)') AS claim_group,
                COALESCE(SUM(qty),0)::float8 AS qty, ${CLAIM_MUTU_AGING_SQL}
           FROM os GROUP BY 1 ORDER BY 1`,
        os.params,
      ),
      query(`WITH ${os.sql} ${byCommodityUnit} FROM os GROUP BY 1, 2`, os.params),
      query(`WITH ${os.sql} ${byLocation} FROM os GROUP BY 1`, os.params),
      query(
        `WITH ${real.sql}
         SELECT COUNT(*)::int AS claims, COALESCE(SUM(qty),0)::float8 AS qty, COALESCE(SUM(amount),0)::float8 AS amount
           FROM real`,
        real.params,
      ),
      query(`WITH ${real.sql} ${byCommodityUnit} FROM real GROUP BY 1, 2`, real.params),
      query(`WITH ${real.sql} ${byLocation} FROM real GROUP BY 1`, real.params),
    ]);

    const active = imp.rows[0] ?? null;
    return res.json({
      success: true,
      data: {
        importId: active?.id ?? null,
        periodLabel: active?.os_period_label ?? null,
        realPeriodLabel: active?.real_period_label ?? null,
        periodMonth: active?.period_month ?? null,
        b2bSource: active?.b2b_source ?? null,
        realAvailable: Boolean(active?.real_sheet_name),
        warnings: active?.warnings ?? [],
        b2b: f.b2b,
        os: osTotals.rows[0] ?? { claims: 0, qty: 0, amount: 0, over90: 0 },
        real: realTotals.rows[0] ?? { claims: 0, qty: 0, amount: 0 },
        agingByGroup: aging.rows,
        byCommodityUnit: mergeSides(osByCu.rows, realByCu.rows, (r) => `${r.commodity}|${r.unit}`, (r) => ({
          commodity: r.commodity,
          unit: r.unit,
        })),
        byLocation: mergeSides(osByLoc.rows, realByLoc.rows, (r) => r.dest, (r) => ({ dest: r.dest, unit: r.unit })),
      },
    });
  } catch (error) {
    logger.error('Claim Mutu dashboard failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Mutu dashboard' } });
  }
};

/**
 * Summary Per Unit: OS and Real per unit per month, one point per month (the latest import of that
 * month). It grows by one point with every monthly upload.
 */
export const getClaimMutuTrend = async (req: AuthRequest, res: Response) => {
  try {
    const f = filtersOf(req);
    const os = buildClaimMutuSideCte('os', f, { scope: 'monthly' });
    const real = buildClaimMutuSideCte('real', f, { scope: 'monthly' });
    const select = `SELECT period_month::text AS month, unit_norm AS unit,
                COALESCE(SUM(qty),0)::float8 AS qty, COALESCE(SUM(amount),0)::float8 AS amount`;
    const [osRes, realRes] = await Promise.all([
      query(`WITH ${os.sql} ${select} FROM os GROUP BY 1, 2`, os.params),
      query(`WITH ${real.sql} ${select} FROM real GROUP BY 1, 2`, real.params),
    ]);
    const rows = mergeSides(osRes.rows, realRes.rows, (r) => `${r.month}|${r.unit}`, (r) => ({
      month: r.month,
      unit: r.unit,
    })).sort((a, b) => a.month.localeCompare(b.month) || a.unit.localeCompare(b.unit));
    return res.json({ success: true, data: { b2b: f.b2b, months: [...new Set(rows.map((r) => r.month))], rows } });
  } catch (error) {
    logger.error('Claim Mutu trend failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Mutu trend' } });
  }
};

// ---------------------------------------------------------------------------------------------
// View table and filters

// Sort keys are the view columns themselves (the UNION's output names); the whitelist is what
// keeps sortKey out of the SQL.
const ROW_SORT_COLUMNS = [
  'os_days', 'cr_date', 'vendor_name', 'claim_group', 'commodity', 'unit', 'dest', 'qty_claim_kg',
  'amount_after_tax_idr', 'metode_payment', 'claim_status', 'cm_no', 'cm_date', 'kebun',
  'crno', 'po_number', 'is_b2b', 'vendor_code', 'vendor_type', 'group_of_vendor', 'cargo_source',
  'keterangan', 'type_of_comp', 'traders', 'created_by', 'sta', 'contract_ext_no', 'comm',
  'material_description', 'company_code', 'claim_type', 'uom', 'amount_before_tax_idr', 'tax',
  'mutu_kontrak_ffa', 'mutu_kontrak_mi', 'mutu_kontrak_dns', 'mutu_kontrak_dobi',
  'mutu_klaim_ffa', 'mutu_klaim_mi', 'mutu_klaim_dns', 'mutu_klaim_dobi',
];
const ROW_SORT: Record<string, string> = Object.fromEntries(ROW_SORT_COLUMNS.map((c) => [c, c]));

export const CLAIM_MUTU_CLAIM_STATUSES = ['Claimed', 'Not Claimed'] as const;

/**
 * The view table: Os_Claim rows (Status Claim "Not Claimed") and Real_Claim rows ("Claimed") in
 * one list, like Shortage Claim. The two never share a claim - a realised claim has left the
 * outstanding sheet. Claimed rows follow the same rule as the realised summary (every import,
 * re-uploads once, CR date range on CLAIM DATE); GROUP and METODE PAYMENT exist on Os_Claim only,
 * so filtering on either leaves no claimed row. Real_Claim's GROUP KEY is its vendor group.
 */
export const listClaimMutuRows = async (req: AuthRequest, res: Response) => {
  try {
    const f = filtersOf(req);
    const q = req.query as Record<string, unknown>;
    const sortKey = ROW_SORT[String(q.sortKey ?? '')] ? String(q.sortKey) : 'os_days';
    const sortDir = String(q.sortDir ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limitRaw = parseInt(String(q.limit ?? '200'), 10);
    const offsetRaw = parseInt(String(q.offset ?? '0'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
    const rawStatuses = Array.isArray(q.claimStatus) ? q.claimStatus : String(q.claimStatus ?? '').split(',');
    const statuses = rawStatuses
      .map((v) => CLAIM_MUTU_CLAIM_STATUSES.find((k) => k.toUpperCase() === String(v).trim().toUpperCase()))
      .filter((v): v is (typeof CLAIM_MUTU_CLAIM_STATUSES)[number] => Boolean(v));

    const os = buildClaimMutuSideCte('os', f);
    const real = buildClaimMutuSideCte('real', f, { params: os.params });
    const params = [...real.params];
    const osOnlyFilter = f.claimGroups.length > 0 || f.metodePayments.length > 0;
    params.push(statuses.length > 0 ? statuses : null);
    const statusParam = `$${params.length}`;
    const combined = `
      SELECT * FROM (
        WITH ${os.sql}
        SELECT id, is_b2b, 'Not Claimed'::text AS claim_status,
               vendor_code, vendor_name, group_of_vendor, vendor_type, cargo_source, keterangan,
               metode_payment, claim_group, type_of_comp, traders, created_by, sta, crno, cr_date::text AS cr_date,
               NULL::text AS cm_no, NULL::text AS cm_date, NULL::text AS kebun, os_days,
               dest, unit_norm AS unit, po_number, contract_ext_no, comm, commodity_norm AS commodity,
               material_description, company_code,
               mutu_kontrak_ffa, mutu_kontrak_mi, mutu_kontrak_dns, mutu_kontrak_dobi,
               mutu_klaim_ffa, mutu_klaim_mi, mutu_klaim_dns, mutu_klaim_dobi,
               claim_type, qty::float8 AS qty_claim_kg, uom,
               amount_before_tax_idr::float8 AS amount_before_tax_idr, tax::float8 AS tax,
               amount::float8 AS amount_after_tax_idr
          FROM os
      ) os_rows
      UNION ALL
      SELECT * FROM (
        WITH ${real.sql}
        SELECT id, is_b2b, 'Claimed'::text AS claim_status,
               vendor_code, vendor_name, group_key AS group_of_vendor, vendor_type, cargo_source, NULL::text AS keterangan,
               NULL::text AS metode_payment, NULL::text AS claim_group, NULL::text AS type_of_comp, traders,
               NULL::text AS created_by, status_claim AS sta, cr_no AS crno, claim_date::text AS cr_date,
               cm_no, cm_date::text AS cm_date, kebun, NULL::int AS os_days,
               dest, unit_norm AS unit, po_number, contract_ext_no, comm, commodity_norm AS commodity,
               material_description, company_code,
               mutu_kontrak_ffa, mutu_kontrak_mi, mutu_kontrak_dns, mutu_kontrak_dobi,
               mutu_klaim_ffa, mutu_klaim_mi, mutu_klaim_dns, mutu_klaim_dobi,
               claim_type, qty::float8 AS qty_claim_kg, uom,
               amount_before_tax_idr::float8 AS amount_before_tax_idr, tax::float8 AS tax,
               amount::float8 AS amount_after_tax_idr
          FROM real
         WHERE ${osOnlyFilter ? 'FALSE' : 'TRUE'}
      ) real_rows`;
    const statusWhere = `WHERE (${statusParam}::text[] IS NULL OR claim_status = ANY(${statusParam}::text[]))`;
    const [count, rows] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE claim_status = 'Claimed')::int AS claimed
           FROM (${combined}) combined ${statusWhere}`,
        params,
      ),
      query(
        `SELECT * FROM (${combined}) combined ${statusWhere}
          ORDER BY ${ROW_SORT[sortKey]} ${sortDir} NULLS LAST, id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    return res.json({
      success: true,
      data: rows.rows,
      meta: { totalCount: count.rows[0]?.n ?? 0, claimedCount: count.rows[0]?.claimed ?? 0, limit, offset },
    });
  } catch (error) {
    logger.error('List Claim Mutu rows failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Mutu rows' } });
  }
};

/**
 * Values each filter can take in the active import. Each list is built with every OTHER filter
 * applied but not its own, so choosing a value never empties its own list.
 */
export const getClaimMutuFilterOptions = async (req: AuthRequest, res: Response) => {
  try {
    const f = filtersOf(req);
    const option = async (key: keyof ClaimMutuFilters, expr: string, withReal: boolean) => {
      const os = buildClaimMutuSideCte('os', f, { omit: key });
      const values = new Set((await query(`WITH ${os.sql} SELECT DISTINCT ${expr} AS v FROM os`, os.params)).rows.map((x) => x.v as string));
      if (withReal) {
        const real = buildClaimMutuSideCte('real', f, { omit: key });
        for (const x of (await query(`WITH ${real.sql} SELECT DISTINCT ${expr} AS v FROM real`, real.params)).rows) values.add(x.v as string);
      }
      return [...values].sort((x, y) => x.localeCompare(y));
    };
    const [commodities, units, vendorTypes, claimGroups, metodePayments] = await Promise.all([
      option('commodities', 'commodity_norm', true),
      option('units', 'unit_norm', true),
      option('vendorTypes', `COALESCE(NULLIF(TRIM(vendor_type),''),'(Blank)')`, true),
      option('claimGroups', `COALESCE(NULLIF(TRIM(claim_group),''),'(Blank)')`, false),
      option('metodePayments', `COALESCE(NULLIF(TRIM(metode_payment),''),'(Blank)')`, false),
    ]);
    return res.json({ success: true, data: { commodities, units, vendorTypes, claimGroups, metodePayments } });
  } catch (error) {
    logger.error('Claim Mutu filter options failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Mutu filter options' } });
  }
};
