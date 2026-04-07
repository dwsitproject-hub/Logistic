import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';
import * as XLSX from 'xlsx';
import { appendColumnFiltersClaimMutu, parseColumnFiltersQuery } from '../utils/claimMutuFilters';

type HeaderRow = (string | number | null | undefined)[];

function normHeader(v: unknown): string {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.toUpperCase();
}

function parseFlexibleDateToIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, '0');
    const dd = String(v.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // dd.mm.yyyy (template example: 23.02.2026)
  const ddmmyyyy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmmyyyy) {
    const dd = ddmmyyyy[1].padStart(2, '0');
    const mm = ddmmyyyy[2].padStart(2, '0');
    const yyyy = ddmmyyyy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function findHeaderRowIndex(rows: any[][]): number {
  // Prefer a single full header row (template row 8) which includes the MUTU subheaders.
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i] || [];
    const set = new Set(r.map(normHeader).filter(Boolean));
    if (!set.has('VENDORCODE')) continue;
    if (!set.has('NO KONTRAK') && !set.has('NOPO')) continue;
    if (set.has('FFA') || set.has('M&I') || set.has('DNS') || set.has('STONE') || set.has('QUANTITY (KG)')) {
      return i;
    }
  }
  // Fallback: the primary header row (template row 5) has VENDORCODE
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i] || [];
    const set = new Set(r.map(normHeader).filter(Boolean));
    if (set.has('VENDORCODE')) return i;
  }
  return 0;
}

function buildHeaders(rows: any[][], headerRowIndex: number): string[] {
  const row1 = (rows[headerRowIndex] || []) as HeaderRow;
  const row2 = (rows[headerRowIndex + 1] || []) as HeaderRow;
  const maxLen = Math.max(row1.length, row2.length);
  const headers: string[] = [];

  // If row1 already contains FFA etc, treat row1 as final header.
  const row1Set = new Set(row1.map(normHeader).filter(Boolean));
  const row1LooksFinal =
    row1Set.has('FFA') || row1Set.has('M&I') || row1Set.has('DNS') || row1Set.has('STONE') || row1Set.has('QUANTITY (KG)');

  for (let c = 0; c < maxLen; c++) {
    const h1 = normHeader(row1[c]);
    const h2 = normHeader(row2[c]);
    if (row1LooksFinal) {
      headers.push(h1);
      continue;
    }
    // Multi-row header: when top says MUTU KLAIM, bottom has FFA/M&I/etc
    if (h1 === 'MUTU KLAIM' && h2) {
      headers.push(h2);
      continue;
    }
    // For qty/amount group
    if ((h1.includes('JLH CLAIM') || h1.includes('AMOUNT') || h1.includes('QUANTITY')) && h2) {
      headers.push(h2);
      continue;
    }
    headers.push(h1 || h2 || '');
  }

  return headers;
}

function rowToObject(headers: string[], row: any[]): Record<string, any> {
  const obj: Record<string, any> = {};
  for (let i = 0; i < Math.min(headers.length, row.length); i++) {
    const h = headers[i];
    if (!h) continue;
    const v = row[i];
    if (v == null || v === '') continue;
    obj[h] = v;
  }
  return obj;
}

export const uploadClaimMutuExcel = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    const sheetNameReq = String((req.body as any)?.sheetName || '').trim();
    if (!file) {
      return res.status(400).json({ success: false, error: { message: 'File is required' } });
    }

    const wb = XLSX.readFile(file.path, { cellDates: true });
    const preferred =
      sheetNameReq ||
      wb.SheetNames.find((n) => String(n).toUpperCase().includes('OSCLAIM-ALLREGION')) ||
      wb.SheetNames[0];
    const ws = wb.Sheets[preferred];
    if (!ws) {
      return res.status(400).json({ success: false, error: { message: `Sheet not found: ${preferred}` } });
    }

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false }) as any[][];
    const headerRowIndex = findHeaderRowIndex(rows);
    const headers = buildHeaders(rows, headerRowIndex);
    const headerSet = new Set(headers.map((h) => normHeader(h)).filter(Boolean));
    const required = ['VENDORCODE', 'VENDOR NAME', 'GROUPOF VENDOR', 'CREATEDBY', 'STA', 'CRNO', 'CR DATE', 'OS DAYS', 'DEST', 'NOPO', 'NO KONTRAK', 'COMM', 'COMM DESC', 'UOM', 'CURRE', 'COMPANY CODE'];
    const missing = required.filter((k) => !headerSet.has(normHeader(k)));
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: { message: `Missing required columns: ${missing.join(', ')}` },
      });
    }
    const dataRows = rows.slice(headerRowIndex + 1);

    const importIns = await query(
      `
      INSERT INTO claim_mutu_imports (file_name, sheet_name, uploaded_by, total_rows, inserted_rows, errors)
      VALUES ($1, $2, $3, 0, 0, '[]'::jsonb)
      RETURNING id
      `,
      [file.originalname, preferred, req.user?.id ?? null]
    );
    const importId = importIns.rows?.[0]?.id;

    let total = 0;
    let inserted = 0;
    const errors: any[] = [];

    for (let idx = 0; idx < dataRows.length; idx++) {
      const row = dataRows[idx];
      if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
      total++;
      try {
        const obj = rowToObject(headers, row);
        const get = (k: string) => obj[normHeader(k)];

        const vendorCode = String(get('VENDORCODE') ?? '').trim() || null;
        const vendorName = String(get('VENDOR NAME') ?? '').trim() || null;
        const groupName = String(get('GROUPOF VENDOR') ?? '').trim() || null;
        const cargoSource = String(get('CARGO SOURCE') ?? '').trim() || null;
        const createdBy = String(get('CREATEDBY') ?? '').trim() || null;
        const sta = String(get('STA') ?? '').trim() || null;
        const crno = String(get('CRNO') ?? '').trim() || null;
        const crDateIso = parseFlexibleDateToIsoDate(get('CR DATE'));
        const osDays = toNumberOrNull(get('OS DAYS'));
        const dest = String(get('DEST') ?? '').trim() || null;
        const poNumber = String(get('NOPO') ?? '').trim() || null;
        const contractExtNo = String(get('NO KONTRAK') ?? '').trim() || null;
        const comm = String(get('COMM') ?? '').trim() || null;
        const product = String(get('COMM DESC') ?? '').trim() || null;
        const uom = String(get('UOM') ?? '').trim() || null;
        const currency = String(get('CURRE') ?? '').trim() || null;
        const companyCode = String(get('COMPANY CODE') ?? '').trim() || null;

        const ffa = toNumberOrNull(get('FFA'));
        const mi = toNumberOrNull(get('M&I'));
        const dns = toNumberOrNull(get('DNS'));
        const dobi = toNumberOrNull(get('DOBI'));
        const stone = toNumberOrNull(get('STONE'));

        const qtyClaim = toNumberOrNull(get('QUANTITY (KG)'));
        const amountAfterTax =
          toNumberOrNull(get('AMOUNT AFTER TAX(IDR)')) ??
          toNumberOrNull(get('AMOUNT AFTER TAX (IDR)')) ??
          toNumberOrNull(get('AMOUNT BEFORE TAX(IDR)')) ??
          toNumberOrNull(get('AMOUNT BEFORE TAX (IDR)')) ??
          null;

        // Skip rows that clearly aren't data
        if (!vendorCode && !contractExtNo && !poNumber) continue;

        await query(
          `
          INSERT INTO claim_mutu_rows (
            import_id,
            vendor_code, vendor_name, group_name, cargo_source, created_by, sta, crno, cr_date, os_days,
            dest, po_number, contract_ext_no, comm, product, uom, currency, company_code,
            mutu_klaim_ffa, mutu_klaim_mi, mutu_klaim_dns, mutu_klaim_dobi, mutu_klaim_stone,
            qty_claim_kg, amount_after_tax_idr, raw
          )
          VALUES (
            $1,
            $2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,$18,
            $19,$20,$21,$22,$23,
            $24,$25,$26::jsonb
          )
          `,
          [
            importId,
            vendorCode, vendorName, groupName, cargoSource, createdBy, sta, crno, crDateIso,
            osDays != null ? Math.trunc(osDays) : null,
            dest, poNumber, contractExtNo, comm, product, uom, currency, companyCode,
            ffa, mi, dns, dobi, stone,
            qtyClaim, amountAfterTax,
            JSON.stringify(obj),
          ]
        );
        inserted++;
      } catch (e: any) {
        errors.push({ rowIndex: headerRowIndex + 2 + idx, message: String(e?.message || e) });
      }
    }

    await query(
      `UPDATE claim_mutu_imports SET total_rows=$2, inserted_rows=$3, errors=$4::jsonb WHERE id=$1`,
      [importId, total, inserted, JSON.stringify(errors)]
    );

    return res.json({
      success: true,
      data: {
        importId,
        sheetName: preferred,
        totalRows: total,
        insertedRows: inserted,
        failedRows: errors.length,
        errorCount: errors.length,
        errors,
      },
    });
  } catch (error) {
    logger.error('Claim Mutu upload/import failed:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to import Claim Mutu excel' },
    });
  }
};

export const listClaimMutuImports = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `
      SELECT
        i.id,
        i.file_name,
        i.sheet_name,
        i.uploaded_at,
        i.total_rows,
        i.inserted_rows,
        i.errors,
        u.full_name AS uploaded_by_name,
        u.username AS uploaded_by_username
      FROM claim_mutu_imports i
      LEFT JOIN users u ON u.id = i.uploaded_by
      ORDER BY i.uploaded_at DESC
      LIMIT 50
      `
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('List Claim Mutu imports failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Mutu imports' } });
  }
};

/** Aggregate Claim Mutu rows by group_name for the selected (or latest) import */
export const listClaimMutuByGroup = async (req: AuthRequest, res: Response) => {
  try {
    const importId = String((req.query as any).importId || '').trim();
    const activeImportId =
      importId ||
      (await query(`SELECT id FROM claim_mutu_imports ORDER BY uploaded_at DESC LIMIT 1`)).rows?.[0]?.id ||
      null;

    if (!activeImportId) {
      return res.json({ success: true, data: [], meta: { importId: null } });
    }

    const result = await query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(group_name), ''), '(Blank)') AS group_name,
        COUNT(*)::int AS row_count,
        COALESCE(SUM(amount_after_tax_idr), 0)::numeric AS total_amount_after_tax_idr,
        COALESCE(SUM(qty_claim_kg), 0)::numeric AS total_qty_claim_kg,
        COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days < 30 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_lt_30,
        COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days >= 30 AND os_days <= 60 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_30_60,
        COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days > 60 AND os_days <= 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_61_90,
        COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days > 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_gt_90
      FROM claim_mutu_rows
      WHERE import_id = $1
      GROUP BY 1
      ORDER BY total_amount_after_tax_idr DESC NULLS LAST, group_name ASC
      `,
      [activeImportId]
    );

    return res.json({
      success: true,
      data: result.rows,
      meta: { importId: activeImportId },
    });
  } catch (error) {
    logger.error('List Claim Mutu by group failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Mutu by group' } });
  }
};

export const listClaimMutuRows = async (req: AuthRequest, res: Response) => {
  try {
    const importId = String((req.query as any).importId || '').trim();
    const sortKeyRaw = String((req.query as any).sortKey || 'os_days').trim();
    const sortDirRaw = String((req.query as any).sortDir || 'desc').trim().toLowerCase();
    const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC';
    const columnFilters = parseColumnFiltersQuery((req.query as any).columnFilters);
    const limitRaw = parseInt(String((req.query as any).limit || '200'), 10);
    const offsetRaw = parseInt(String((req.query as any).offset || '0'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const activeImportId =
      importId ||
      (await query(`SELECT id FROM claim_mutu_imports ORDER BY uploaded_at DESC LIMIT 1`)).rows?.[0]?.id ||
      null;

    if (!activeImportId) {
      return res.json({ success: true, data: [], meta: { totalCount: 0, importId: null } });
    }

    // Allow sorting by any visible column (including aging buckets).
    const SORT_SQL: Record<string, string> = {
      vendor: `vendor_name`,
      vendor_code: `vendor_code`,
      vendor_name: `vendor_name`,
      group_name: `group_name`,
      cargo_source: `cargo_source`,
      created_by: `created_by`,
      sta: `sta`,
      crno: `crno`,
      cr_date: `cr_date`,
      os_days: `os_days`,
      dest: `dest`,
      po_number: `po_number`,
      contract_ext_no: `contract_ext_no`,
      comm: `comm`,
      product: `product`,
      uom: `uom`,
      currency: `currency`,
      company_code: `company_code`,
      mutu_klaim_ffa: `mutu_klaim_ffa`,
      mutu_klaim_mi: `mutu_klaim_mi`,
      mutu_klaim_dns: `mutu_klaim_dns`,
      mutu_klaim_dobi: `mutu_klaim_dobi`,
      mutu_klaim_stone: `mutu_klaim_stone`,
      qty_claim_kg: `qty_claim_kg`,
      amount_after_tax_idr: `amount_after_tax_idr`,
      a_lt_30: `a_lt_30`,
      a_30_60: `a_30_60`,
      a_61_90: `a_61_90`,
      a_gt_90: `a_gt_90`,
    };
    const sortKey = SORT_SQL[sortKeyRaw] ? sortKeyRaw : 'os_days';
    const sortExpr = SORT_SQL[sortKey];
    const orderBy =
      sortKey === 'vendor'
        ? `vendor_name ${sortDir} NULLS LAST, vendor_code ${sortDir} NULLS LAST, id DESC`
        : `${sortExpr} ${sortDir} NULLS LAST, id DESC`;

    // Column filters (Excel-like)
    const cf = appendColumnFiltersClaimMutu(columnFilters, 2);
    const whereSql = `WHERE import_id = $1${cf.sql}`;

    const countRes = await query(`SELECT COUNT(*)::int AS count FROM claim_mutu_rows ${whereSql}`, [activeImportId, ...cf.params]);
    const totalCount = Number(countRes.rows?.[0]?.count) || 0;

    const rowsRes = await query(
      `
      SELECT
        id,
        vendor_code, vendor_name, group_name, cargo_source, created_by,
        sta, crno, cr_date, os_days, dest, po_number, contract_ext_no,
        comm, product, uom, currency, company_code,
        mutu_klaim_ffa, mutu_klaim_mi, mutu_klaim_dns, mutu_klaim_dobi, mutu_klaim_stone,
        qty_claim_kg, amount_after_tax_idr,
        CASE WHEN os_days IS NOT NULL AND os_days < 30 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_lt_30,
        CASE WHEN os_days IS NOT NULL AND os_days >= 30 AND os_days <= 60 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_30_60,
        CASE WHEN os_days IS NOT NULL AND os_days > 60 AND os_days <= 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_61_90,
        CASE WHEN os_days IS NOT NULL AND os_days > 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_gt_90,
        created_at
      FROM claim_mutu_rows
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${cf.nextIndex} OFFSET $${cf.nextIndex + 1}
      `,
      [activeImportId, ...cf.params, limit, offset]
    );

    return res.json({
      success: true,
      data: rowsRes.rows,
      meta: { totalCount, importId: activeImportId, limit, offset, sortKey, sortDir: sortDir.toLowerCase() },
    });
  } catch (error) {
    logger.error('List Claim Mutu rows failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Mutu rows' } });
  }
};

export const listClaimMutuDistinctValues = async (req: AuthRequest, res: Response) => {
  try {
    const importId = String((req.query as any).importId || '').trim();
    const column = String((req.query as any).column || '').trim();
    const q = String((req.query as any).q || '').trim();
    const limitRaw = parseInt(String((req.query as any).limit || '200'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

    if (!importId) {
      return res.status(400).json({ success: false, error: { message: 'importId is required' } });
    }
    if (!column) {
      return res.status(400).json({ success: false, error: { message: 'column is required' } });
    }

    const COL_EXPR: Record<string, string> = {
      group_name: `group_name`,
      product: `product`,
      company_code: `company_code`,
      dest: `dest`,
      cargo_source: `cargo_source`,
      vendor: `COALESCE(vendor_name,'') || ' (' || COALESCE(vendor_code,'') || ')'`,
    };
    const expr = COL_EXPR[column];
    if (!expr) {
      return res.status(400).json({ success: false, error: { message: `Unsupported column: ${column}` } });
    }

    const params: any[] = [importId];
    let where = `WHERE import_id = $1`;
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (${expr})::text ILIKE $2`;
    }

    const sql = `
      SELECT
        NULLIF(TRIM((${expr})::text), '') AS value,
        COUNT(*)::int AS count
      FROM claim_mutu_rows
      ${where}
      GROUP BY 1
      ORDER BY count DESC, value ASC NULLS LAST
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    const r = await query(sql, params);
    const values = (r.rows || [])
      .filter((x: any) => x && x.value != null)
      .map((x: any) => ({ value: String(x.value), count: Number(x.count) || 0 }));

    return res.json({ success: true, data: { column, values } });
  } catch (error) {
    logger.error('List Claim Mutu distinct values failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load distinct values' } });
  }
};

