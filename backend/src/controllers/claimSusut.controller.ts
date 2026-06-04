import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';
import * as XLSX from 'xlsx';

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
  const ddmmyyyy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmmyyyy) {
    const dd = ddmmyyyy[1].padStart(2, '0');
    const mm = ddmmyyyy[2].padStart(2, '0');
    const yyyy = ddmmyyyy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
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
  // Template says row 5-7 are header. We scan first 40 rows for a row containing key fields.
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i] || [];
    const set = new Set(r.map(normHeader).filter(Boolean));
    const hasVendor = set.has('VENDOR CODE') || set.has('VENDORCODE');
    const hasCr = set.has('CR NO') || set.has('CRNO') || set.has('CR DATE');
    const hasOs = set.has('OS DAYS') || set.has('OUTSTANDING');
    const hasPoOrContract = set.has('NO PO') || set.has('NOPO') || set.has('NO KONTRAK');
    if (!hasVendor) continue;
    if (!hasCr) continue;
    if (hasOs && hasPoOrContract) return i;
  }
  // Fallback: first row that has VENDORCODE
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i] || [];
    const set = new Set(r.map(normHeader).filter(Boolean));
    if (set.has('VENDOR CODE') || set.has('VENDORCODE')) return i;
  }
  return 0;
}

function buildHeaders3(rows: any[][], headerRowIndex: number): string[] {
  const row1 = (rows[headerRowIndex] || []) as HeaderRow;
  const row2 = (rows[headerRowIndex + 1] || []) as HeaderRow;
  const row3 = (rows[headerRowIndex + 2] || []) as HeaderRow;
  const maxLen = Math.max(row1.length, row2.length, row3.length);
  const headers: string[] = [];

  // Prefer the deepest header cell when present. Some SAP files repeat headers on row 6-7,
  // but row3 (headerRowIndex+2) is often already the first DATA row; detect that and ignore.
  const row3Set = new Set(row3.map(normHeader).filter(Boolean));
  const row3LooksLikeHeader =
    (row3Set.has('VENDOR CODE') || row3Set.has('VENDORCODE')) &&
    (row3Set.has('CR DATE') || row3Set.has('CR NO') || row3Set.has('CRNO'));

  for (let c = 0; c < maxLen; c++) {
    const h3 = row3LooksLikeHeader ? normHeader(row3[c]) : '';
    const h2 = normHeader(row2[c]);
    const h1 = normHeader(row1[c]);
    const h = h3 || h2 || h1 || '';
    headers.push(h);
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

export const uploadClaimSusutExcel = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    const sheetNameReq = String((req.body as any)?.sheetName || '').trim();
    if (!file) {
      return res.status(400).json({ success: false, error: { message: 'File is required' } });
    }

    const wb = XLSX.readFile(file.path, { cellDates: true });
    const preferred = sheetNameReq || wb.SheetNames[0];
    const ws = wb.Sheets[preferred];
    if (!ws) {
      return res.status(400).json({ success: false, error: { message: `Sheet not found: ${preferred}` } });
    }

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false }) as any[][];
    const headerRowIndex = findHeaderRowIndex(rows);
    const headers = buildHeaders3(rows, headerRowIndex);
    const headerSet = new Set(headers.map((h) => normHeader(h)).filter(Boolean));

    // NOTE: SAP exports often use spaced headers (e.g. "VENDOR CODE", "CR NO").
    // Validate against the template's real headers (row 7) but keep fallbacks.
    const requiredAnyOf: Array<{ label: string; keys: string[] }> = [
      { label: 'VENDOR CODE', keys: ['VENDOR CODE', 'VENDORCODE'] },
      { label: 'VENDOR NAME', keys: ['VENDOR NAME'] },
      { label: 'VENDOR TYPE', keys: ['VENDOR TYPE'] },
      { label: 'CREATED BY', keys: ['CREATED BY', 'CREATEDBY'] },
      { label: 'STA', keys: ['STA'] },
      { label: 'CR NO', keys: ['CR NO', 'CRNO'] },
      { label: 'CR DATE', keys: ['CR DATE'] },
      { label: 'OS DAYS', keys: ['OS DAYS', 'OUTSTANDING'] },
      { label: 'GROUP OF TRANSPORT', keys: ['GROUP OF TRANSPORT'] },
      { label: 'METODE PAYMENT', keys: ['METODE PAYMENT'] },
      { label: 'DEST', keys: ['DEST'] },
      { label: 'NO PO', keys: ['NO PO', 'NOPO'] },
      { label: 'NO KONTRAK', keys: ['NO KONTRAK', 'NO KONTRAK '] },
      { label: 'COMM', keys: ['COMM'] },
      { label: 'COMMODITY', keys: ['COMMODITY'] },
      { label: 'UOM', keys: ['UOM'] },
      { label: 'CURRE', keys: ['CURRE'] },
      { label: 'CODE', keys: ['CODE', 'COMPANY CODE'] },
      { label: 'KETERANGAN', keys: ['KETERANGAN', 'REMARKS'] },
      { label: 'TYPE', keys: ['TYPE'] },
      { label: 'DIAJUKAN', keys: ['DIAJUKAN'] },
    ];
    const missing = requiredAnyOf
      .filter((r) => !r.keys.some((k) => headerSet.has(normHeader(k))))
      .map((r) => r.label);
    // Amount columns are sometimes quirky in SAP exports, validate loosely.
    const hasAmtBefore = headerSet.has('AMOUNT BEFORE TAX(IDR)') || headerSet.has('AMOUNT BEFORE TAX (IDR)');
    const hasTax = headerSet.has('TAX');
    const hasAmtAfter = headerSet.has('(IDR)') || headerSet.has('AMOUNT AFTER TAX(IDR)') || headerSet.has('AMOUNT AFTER TAX (IDR)');
    if (missing.length > 0 || !hasAmtBefore || !hasTax || !hasAmtAfter) {
      const extraMissing: string[] = [];
      if (!hasAmtBefore) extraMissing.push('AMOUNT BEFORE TAX(IDR)');
      if (!hasTax) extraMissing.push('TAX');
      if (!hasAmtAfter) extraMissing.push('AMOUNT AFTER TAX (IDR)');
      const allMissing = [...missing, ...extraMissing];
      return res.status(400).json({
        success: false,
        error: { message: `Missing required columns: ${allMissing.join(', ')}` },
      });
    }

    const dataRows = rows.slice(headerRowIndex + 3);

    const importIns = await query(
      `
      INSERT INTO claim_susut_imports (file_name, sheet_name, uploaded_by, total_rows, inserted_rows, errors)
      VALUES ($1, $2, $3, 0, 0, '[]'::jsonb)
      RETURNING id
      `,
      [file.originalname, preferred, req.user?.id ?? null],
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
        const getAny = (keys: string[]) => {
          for (const k of keys) {
            const v = get(k);
            if (v != null && v !== '') return v;
          }
          return null;
        };

        const vendorCode = String(getAny(['VENDOR CODE', 'VENDORCODE']) ?? '').trim() || null;
        const vendorName = String(getAny(['VENDOR NAME']) ?? '').trim() || null;
        const vendorType = String(getAny(['VENDOR TYPE']) ?? '').trim() || null;
        const createdBy = String(getAny(['CREATED BY', 'CREATEDBY']) ?? '').trim() || null;
        const sta = String(get('STA') ?? '').trim() || null;
        const crno = String(getAny(['CR NO', 'CRNO']) ?? '').trim() || null;
        const crDateIso = parseFlexibleDateToIsoDate(get('CR DATE'));
        const osDays = toNumberOrNull(getAny(['OS DAYS', 'OUTSTANDING']));
        const groupOfTransport = String(get('GROUP OF TRANSPORT') ?? '').trim() || null;
        const paymentMethod = String(get('METODE PAYMENT') ?? '').trim() || null;
        const dest = String(get('DEST') ?? '').trim() || null;
        const poNumber = String(getAny(['NO PO', 'NOPO']) ?? '').trim() || null;
        const contractExtNo = String(get('NO KONTRAK') ?? '').trim() || null;
        const comm = String(get('COMM') ?? '').trim() || null;
        const commodity = String(get('COMMODITY') ?? '').trim() || null;
        const uom = String(get('UOM') ?? '').trim() || null;
        const currency = String(get('CURRE') ?? '').trim() || null;
        const companyCode = String(get('CODE') ?? '').trim() || null;
        const remarks = String(get('KETERANGAN') ?? '').trim() || null;
        const type = String(get('TYPE') ?? '').trim() || null;
        const qtyClaim = toNumberOrNull(get('DIAJUKAN'));

        const amountBeforeTax =
          toNumberOrNull(get('AMOUNT BEFORE TAX(IDR)')) ?? toNumberOrNull(get('AMOUNT BEFORE TAX (IDR)')) ?? null;
        const tax = toNumberOrNull(get('TAX'));
        const amountAfterTax =
          toNumberOrNull(get('(IDR)')) ??
          toNumberOrNull(get('AMOUNT AFTER TAX(IDR)')) ??
          toNumberOrNull(get('AMOUNT AFTER TAX (IDR)')) ??
          null;

        // Skip rows that clearly aren't data
        if (!vendorCode && !contractExtNo && !poNumber) continue;

        await query(
          `
          INSERT INTO claim_susut_rows (
            import_id,
            vendor_code, vendor_name, vendor_type, created_by, sta, crno, cr_date, os_days,
            group_of_transport, payment_method, dest, po_number, contract_ext_no,
            comm, commodity, uom, currency, company_code, remarks, type,
            qty_claim, amount_before_tax_idr, tax, amount_after_tax_idr,
            raw
          )
          VALUES (
            $1,
            $2,$3,$4,$5,$6,$7,$8,$9,
            $10,$11,$12,$13,$14,
            $15,$16,$17,$18,$19,$20,$21,
            $22,$23,$24,$25,
            $26::jsonb
          )
          `,
          [
            importId,
            vendorCode,
            vendorName,
            vendorType,
            createdBy,
            sta,
            crno,
            crDateIso,
            osDays != null ? Math.trunc(osDays) : null,
            groupOfTransport,
            paymentMethod,
            dest,
            poNumber,
            contractExtNo,
            comm,
            commodity,
            uom,
            currency,
            companyCode,
            remarks,
            type,
            qtyClaim,
            amountBeforeTax,
            tax,
            amountAfterTax,
            JSON.stringify(obj),
          ],
        );
        inserted++;
      } catch (e: any) {
        errors.push({ rowIndex: headerRowIndex + 4 + idx, message: String(e?.message || e) });
      }
    }

    await query(`UPDATE claim_susut_imports SET total_rows=$2, inserted_rows=$3, errors=$4::jsonb WHERE id=$1`, [
      importId,
      total,
      inserted,
      JSON.stringify(errors),
    ]);

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
    logger.error('Claim Susut upload/import failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to import Claim Susut excel' } });
  }
};

export const listClaimSusutImports = async (_req: AuthRequest, res: Response) => {
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
      FROM claim_susut_imports i
      LEFT JOIN users u ON u.id = i.uploaded_by
      ORDER BY i.uploaded_at DESC
      LIMIT 50
      `,
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('List Claim Susut imports failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut imports' } });
  }
};

export const listClaimSusutRows = async (req: AuthRequest, res: Response) => {
  try {
    const importId = String((req.query as any).importId || '').trim();
    const sortKeyRaw = String((req.query as any).sortKey || 'os_days').trim();
    const sortDirRaw = String((req.query as any).sortDir || 'desc').trim().toLowerCase();
    const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC';
    const limitRaw = parseInt(String((req.query as any).limit || '200'), 10);
    const offsetRaw = parseInt(String((req.query as any).offset || '0'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const activeImportId =
      importId ||
      (await query(`SELECT id FROM claim_susut_imports ORDER BY uploaded_at DESC LIMIT 1`)).rows?.[0]?.id ||
      null;

    if (!activeImportId) {
      return res.json({ success: true, data: [], meta: { totalCount: 0, importId: null } });
    }

    const SORT_SQL: Record<string, string> = {
      vendor_code: `vendor_code`,
      vendor_name: `vendor_name`,
      vendor_type: `vendor_type`,
      created_by: `created_by`,
      sta: `sta`,
      crno: `crno`,
      cr_date: `cr_date`,
      os_days: `os_days`,
      group_of_transport: `group_of_transport`,
      payment_method: `payment_method`,
      dest: `dest`,
      po_number: `po_number`,
      contract_ext_no: `contract_ext_no`,
      comm: `comm`,
      commodity: `commodity`,
      uom: `uom`,
      currency: `currency`,
      company_code: `company_code`,
      remarks: `remarks`,
      type: `type`,
      qty_claim: `qty_claim`,
      amount_before_tax_idr: `amount_before_tax_idr`,
      tax: `tax`,
      amount_after_tax_idr: `amount_after_tax_idr`,
      a_0_30: `a_0_30`,
      a_31_60: `a_31_60`,
      a_61_90: `a_61_90`,
      a_gt_90: `a_gt_90`,
    };
    const sortKey = SORT_SQL[sortKeyRaw] ? sortKeyRaw : 'os_days';
    const sortExpr = SORT_SQL[sortKey];
    const orderBy = `${sortExpr} ${sortDir} NULLS LAST, id DESC`;

    const countRes = await query(`SELECT COUNT(*)::int AS count FROM claim_susut_rows WHERE import_id=$1`, [activeImportId]);
    const totalCount = Number(countRes.rows?.[0]?.count) || 0;

    const rowsRes = await query(
      `
      SELECT
        id,
        vendor_code, vendor_name, vendor_type, created_by,
        sta, crno, cr_date, os_days,
        group_of_transport, payment_method,
        dest, po_number, contract_ext_no,
        comm, commodity, uom, currency, company_code,
        remarks, type,
        qty_claim, amount_before_tax_idr, tax, amount_after_tax_idr,
        CASE WHEN os_days IS NOT NULL AND os_days >= 0 AND os_days <= 30 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_0_30,
        CASE WHEN os_days IS NOT NULL AND os_days >= 31 AND os_days <= 60 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_31_60,
        CASE WHEN os_days IS NOT NULL AND os_days >= 61 AND os_days <= 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_61_90,
        CASE WHEN os_days IS NOT NULL AND os_days > 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END AS a_gt_90,
        created_at
      FROM claim_susut_rows
      WHERE import_id=$1
      ORDER BY ${orderBy}
      LIMIT $2 OFFSET $3
      `,
      [activeImportId, limit, offset],
    );

    return res.json({
      success: true,
      data: rowsRes.rows,
      meta: { totalCount, importId: activeImportId, limit, offset, sortKey, sortDir: sortDir.toLowerCase() },
    });
  } catch (error) {
    logger.error('List Claim Susut rows failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut rows' } });
  }
};

export const listClaimSusutByGroupOfTransport = async (req: AuthRequest, res: Response) => {
  try {
    const importId = String((req.query as any).importId || '').trim();
    const activeImportId =
      importId ||
      (await query(`SELECT id FROM claim_susut_imports ORDER BY uploaded_at DESC LIMIT 1`)).rows?.[0]?.id ||
      null;

    if (!activeImportId) {
      return res.json({ success: true, data: [], meta: { importId: null } });
    }

    const result = await query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(group_of_transport), ''), '(Blank)') AS group_of_transport,
        COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days >= 0 AND os_days <= 30 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_0_30,
        COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days >= 31 AND os_days <= 60 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_31_60,
        COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days >= 61 AND os_days <= 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_61_90,
        COALESCE(SUM(CASE WHEN os_days IS NOT NULL AND os_days > 90 THEN COALESCE(amount_after_tax_idr, 0) ELSE 0 END), 0)::numeric AS a_gt_90,
        COALESCE(SUM(CASE
          WHEN os_days IS NOT NULL AND (
            (os_days >= 0 AND os_days <= 30)
            OR (os_days >= 31 AND os_days <= 60)
            OR (os_days >= 61 AND os_days <= 90)
            OR (os_days > 90)
          )
          THEN COALESCE(amount_after_tax_idr, 0)
          ELSE 0
        END), 0)::numeric AS grand_total
      FROM claim_susut_rows
      WHERE import_id = $1
      GROUP BY 1
      ORDER BY grand_total DESC NULLS LAST, a_gt_90 DESC NULLS LAST, a_61_90 DESC NULLS LAST, a_31_60 DESC NULLS LAST, a_0_30 DESC NULLS LAST, group_of_transport ASC
      `,
      [activeImportId],
    );

    return res.json({ success: true, data: result.rows, meta: { importId: activeImportId } });
  } catch (error) {
    logger.error('List Claim Susut by group of transport failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut by group of transport' } });
  }
};

