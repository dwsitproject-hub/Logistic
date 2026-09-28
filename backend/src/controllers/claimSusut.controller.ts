import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../database/connection';
import logger from '../utils/logger';
import * as XLSX from 'xlsx';
import {
  buildClaimSusutFilteredCte,
  CLAIM_SUSUT_BLANK,
  CLAIM_SUSUT_AGING_SUM_SQL,
  CLAIM_SUSUT_ROW_AGING_SQL,
  nestClaimSusutTree,
  parseClaimSusutQueryFilters,
  parseClaimSusutStoredErrors,
  parseOptionalUuid,
  type ClaimSusutFilterScope,
  type ClaimSusutQueryFilters,
  type ClaimSusutTreeLeaf,
} from '../utils/claimSusutQuerySql';
import {
  findOsClaimSheet,
  findRealClaimSheet,
  parseOsClaimSheet,
  parseRealClaimSheet,
} from '../utils/claimSusutWorkbook';

/**
 * Upload one SAP Claim Susut workbook.
 *
 * OS_CLAIM is mandatory - it is the data the page runs on. REAL_CLAIM is read too when the workbook
 * has it, for the Section 1 realisation dashboard; a problem with it never blocks the outstanding
 * import, it comes back as a warning. Every other sheet (PIVOT included) is ignored: reading
 * `SheetNames[0]` is what used to import the PIVOT summary as if it were claim rows.
 */
export const uploadClaimSusutExcel = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    const sheetNameReq = String((req.body as any)?.sheetName || '').trim();
    if (!file) {
      return res.status(400).json({ success: false, error: { message: 'File is required' } });
    }

    const wb = XLSX.readFile(file.path, { cellDates: true });
    const osSheet = findOsClaimSheet(wb.SheetNames, sheetNameReq || null);
    if (!osSheet) {
      return res.status(400).json({
        success: false,
        error: {
          message: `Sheet OS_CLAIM not found. Sheets in this file: ${wb.SheetNames.join(', ') || '(none)'}`,
        },
      });
    }

    const os = parseOsClaimSheet(wb.Sheets[osSheet]);
    if (os.missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: { message: `Missing required columns in ${osSheet}: ${os.missing.join(', ')}` },
      });
    }

    const realSheet = findRealClaimSheet(wb.SheetNames);
    const real = realSheet ? parseRealClaimSheet(wb.Sheets[realSheet]) : null;
    const realWarning =
      real && real.missing.length > 0
        ? `${realSheet} was not imported - missing columns: ${real.missing.join(', ')}`
        : null;
    const realRows = real && real.missing.length === 0 ? real.rows : [];

    const importIns = await query(
      `
      INSERT INTO claim_susut_imports
        (file_name, sheet_name, uploaded_by, total_rows, inserted_rows, errors,
         os_period_label, real_sheet_name, real_period_label)
      VALUES ($1, $2, $3, 0, 0, '[]'::jsonb, $4, $5, $6)
      RETURNING id
      `,
      [
        file.originalname,
        osSheet,
        req.user?.id ?? null,
        os.periodLabel,
        realRows.length > 0 ? realSheet : null,
        realRows.length > 0 ? real?.periodLabel ?? null : null,
      ],
    );
    const importId = importIns.rows?.[0]?.id;

    let inserted = 0;
    const errors: Array<{ rowIndex: number; message: string; sheet?: string }> = [];

    for (const r of os.rows) {
      try {
        await query(
          `
          INSERT INTO claim_susut_rows (
            import_id,
            vendor_code, vendor_name, vendor_type, created_by, sta, crno, cr_date, os_days,
            group_of_transport, payment_method, dest, po_number, contract_ext_no,
            comm, commodity, uom, currency, company_code, remarks, type,
            qty_claim, amount_before_tax_idr, tax, amount_after_tax_idr,
            material_description, raw
          )
          VALUES (
            $1,
            $2,$3,$4,$5,$6,$7,$8,$9,
            $10,$11,$12,$13,$14,
            $15,$16,$17,$18,$19,$20,$21,
            $22,$23,$24,$25,
            $26,$27::jsonb
          )
          `,
          [
            importId,
            r.vendorCode, r.vendorName, r.vendorType, r.createdBy, r.sta, r.crno, r.crDate, r.osDays,
            r.groupOfTransport, r.paymentMethod, r.dest, r.poNumber, r.contractExtNo,
            r.comm, r.commodity, r.uom, r.currency, r.companyCode, r.remarks, r.type,
            r.qtyClaim, r.amountBeforeTax, r.tax, r.amountAfterTax,
            r.materialDescription, JSON.stringify(r.raw),
          ],
        );
        inserted++;
      } catch (e: any) {
        errors.push({ rowIndex: r.sheetRow, sheet: osSheet, message: String(e?.message || e) });
      }
    }

    let realInserted = 0;
    for (const r of realRows) {
      try {
        await query(
          `
          INSERT INTO claim_susut_real_rows (
            import_id,
            vendor_code, vendor_name, cargo_source, cr_no, claim_date, cm_date, po_cn_date,
            po_number, comm, commodity, material_description, dest, status_claim, company_code,
            type_of_claim, currency, qty_approved, uom, amount_before_tax_idr, tax, amount_after_tax_idr,
            remarks, transport_group, raw
          )
          VALUES (
            $1,
            $2,$3,$4,$5,$6,$7,$8,
            $9,$10,$11,$12,$13,$14,$15,
            $16,$17,$18,$19,$20,$21,$22,
            $23,$24,$25::jsonb
          )
          `,
          [
            importId,
            r.vendorCode, r.vendorName, r.cargoSource, r.crNo, r.claimDate, r.cmDate, r.poCnDate,
            r.poNumber, r.comm, r.commodity, r.materialDescription, r.dest, r.statusClaim, r.companyCode,
            r.typeOfClaim, r.currency, r.qtyApproved, r.uom, r.amountBeforeTax, r.tax, r.amountAfterTax,
            r.remarks, r.transportGroup, JSON.stringify(r.raw),
          ],
        );
        realInserted++;
      } catch (e: any) {
        errors.push({ rowIndex: r.sheetRow, sheet: realSheet ?? undefined, message: String(e?.message || e) });
      }
    }

    await query(
      `UPDATE claim_susut_imports
          SET total_rows = $2, inserted_rows = $3, errors = $4::jsonb,
              real_total_rows = $5, real_inserted_rows = $6
        WHERE id = $1`,
      [importId, os.rows.length, inserted, JSON.stringify(errors), realRows.length, realInserted],
    );

    return res.json({
      success: true,
      data: {
        importId,
        sheetName: osSheet,
        periodLabel: os.periodLabel,
        totalRows: os.rows.length,
        insertedRows: inserted,
        failedRows: errors.length,
        errorCount: errors.length,
        errors,
        realSheetName: realRows.length > 0 ? realSheet : null,
        realPeriodLabel: realRows.length > 0 ? real?.periodLabel ?? null : null,
        realTotalRows: realRows.length,
        realInsertedRows: realInserted,
        realWarning,
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
        i.os_period_label,
        i.real_sheet_name,
        i.real_period_label,
        i.real_total_rows,
        i.real_inserted_rows,
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

export const getClaimSusutImportById = async (req: AuthRequest, res: Response) => {
  try {
    const importId = parseOptionalUuid((req.params as { id?: string })?.id);
    if (!importId) {
      return res.status(400).json({ success: false, error: { message: 'Invalid import id' } });
    }
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
      WHERE i.id = $1::uuid
      LIMIT 1
      `,
      [importId],
    );
    const row = result.rows?.[0];
    if (!row) {
      return res.status(404).json({ success: false, error: { message: 'Claim Susut import not found' } });
    }
    const errors = parseClaimSusutStoredErrors(row.errors);
    const totalRows = Number(row.total_rows) || 0;
    const insertedRows = Number(row.inserted_rows) || 0;
    const failedRows = errors.length;
    return res.json({
      success: true,
      data: {
        ...row,
        errors,
        failedRows,
        successRate:
          totalRows > 0 ? Number(((insertedRows / totalRows) * 100).toFixed(1)) : insertedRows > 0 ? 100 : 0,
      },
    });
  } catch (error) {
    logger.error('Get Claim Susut import failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut import' } });
  }
};

function claimSusutQueryFromReq(req: AuthRequest): ClaimSusutQueryFilters {
  return parseClaimSusutQueryFilters((req.query || {}) as Record<string, unknown>);
}

async function runClaimSusutCte(
  filters: ClaimSusutQueryFilters,
  scope: ClaimSusutFilterScope,
  selectSql: string,
  extraParams: unknown[] = [],
) {
  const base = buildClaimSusutFilteredCte(filters, scope);
  return query(`${base.sql}\n${selectSql}`, [...base.params, ...extraParams]);
}

export const getClaimSusutFilterOptions = async (req: AuthRequest, res: Response) => {
  try {
    const filters = claimSusutQueryFromReq(req);
    const result = await runClaimSusutCte(
      filters,
      'options',
      `
      SELECT
        ARRAY(SELECT DISTINCT product FROM filtered ORDER BY 1) AS products,
        ARRAY(SELECT DISTINCT region_plant FROM filtered ORDER BY 1) AS plants,
        ARRAY(SELECT DISTINCT source FROM filtered ORDER BY 1) AS sources,
        ARRAY(SELECT DISTINCT incoterm FROM filtered ORDER BY 1) AS incoterms,
        ARRAY(SELECT DISTINCT group_of_transport_norm FROM filtered ORDER BY 1) AS groups_of_transport
      `,
    );
    const row = result.rows?.[0] || {};
    return res.json({
      success: true,
      data: {
        products: row.products || [],
        plants: row.plants || [],
        sources: row.sources || [],
        incoterms: row.incoterms || [],
        groupsOfTransport: row.groups_of_transport || [],
      },
      meta: { importId: filters.importId },
    });
  } catch (error) {
    logger.error('Claim Susut filter options failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut filter options' } });
  }
};

export const getClaimSusutSummary = async (req: AuthRequest, res: Response) => {
  try {
    const filters = claimSusutQueryFromReq(req);
    const result = await runClaimSusutCte(
      filters,
      'summary',
      `
      SELECT
        COALESCE(SUM(qty_claim), 0)::float8 AS qty_claim,
        COALESCE(SUM(amount_after_tax_idr), 0)::float8 AS amount_after_tax_idr,
        COUNT(*)::int AS row_count
      FROM filtered
      `,
    );
    const row = result.rows?.[0] || {};
    return res.json({
      success: true,
      data: {
        qtyClaim: Number(row.qty_claim) || 0,
        amountAfterTax: Number(row.amount_after_tax_idr) || 0,
        rowCount: Number(row.row_count) || 0,
      },
      meta: { importId: filters.importId },
    });
  } catch (error) {
    logger.error('Claim Susut summary failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut summary' } });
  }
};

/**
 * Section 1 realisation dashboard: the REAL_CLAIM rows of the active import.
 *
 * "Active" is chosen exactly as for the outstanding data - the requested import, else the latest -
 * so the two halves of Section 1 always come from the same file. Not narrowed by the page filters:
 * those are resolved through SAP contract data on the outstanding rows, and REAL_CLAIM is a short
 * period list shown whole, as the sheet shows it.
 */
export const getClaimSusutRealized = async (req: AuthRequest, res: Response) => {
  try {
    const importId = parseOptionalUuid((req.query as Record<string, unknown>)?.importId);
    const imp = await query(
      `SELECT id, real_sheet_name, real_period_label, os_period_label
         FROM claim_susut_imports
        WHERE ($1::uuid IS NULL OR id = $1::uuid)
        ORDER BY CASE WHEN $1::uuid IS NOT NULL THEN 0 ELSE 1 END, uploaded_at DESC NULLS LAST
        LIMIT 1`,
      [importId],
    );
    const active = imp.rows[0];
    if (!active) {
      return res.json({ success: true, data: { importId: null, available: false, rows: [] } });
    }
    const rowsRes = await query(
      `SELECT vendor_code, vendor_name, cargo_source, cr_no,
              claim_date::text, cm_date::text, po_number, commodity, material_description, dest,
              status_claim, company_code, type_of_claim,
              COALESCE(qty_approved, 0)::float8 AS qty_approved, uom,
              COALESCE(amount_after_tax_idr, 0)::float8 AS amount_after_tax_idr,
              remarks,
              COALESCE(NULLIF(TRIM(transport_group), ''), '${CLAIM_SUSUT_BLANK}') AS transport_group
         FROM claim_susut_real_rows
        WHERE import_id = $1
        ORDER BY vendor_name NULLS LAST, cm_date NULLS LAST, cr_no`,
      [active.id],
    );
    const rows = rowsRes.rows as Array<Record<string, any>>;

    type Agg = { claims: number; qty: number; amount: number };
    const add = (m: Map<string, Agg & Record<string, unknown>>, key: string, extra: Record<string, unknown>, r: Record<string, any>) => {
      const cur = m.get(key) ?? { claims: 0, qty: 0, amount: 0, ...extra };
      cur.claims += 1;
      cur.qty += Number(r.qty_approved) || 0;
      cur.amount += Number(r.amount_after_tax_idr) || 0;
      m.set(key, cur);
    };
    const byTransport = new Map<string, Agg & Record<string, unknown>>();
    const byVendor = new Map<string, Agg & Record<string, unknown>>();
    for (const r of rows) {
      add(byTransport, r.transport_group, { transport_group: r.transport_group }, r);
      const vk = r.vendor_code || r.vendor_name || CLAIM_SUSUT_BLANK;
      add(byVendor, vk, { vendor_code: r.vendor_code, vendor_name: r.vendor_name }, r);
    }
    const byAmount = (a: Agg, b: Agg) => b.amount - a.amount;

    return res.json({
      success: true,
      data: {
        importId: active.id,
        available: Boolean(active.real_sheet_name) || rows.length > 0,
        sheetName: active.real_sheet_name,
        periodLabel: active.real_period_label,
        osPeriodLabel: active.os_period_label,
        totals: {
          claims: rows.length,
          qty: rows.reduce((s, r) => s + (Number(r.qty_approved) || 0), 0),
          amount: rows.reduce((s, r) => s + (Number(r.amount_after_tax_idr) || 0), 0),
        },
        byTransport: [...byTransport.values()].sort(byAmount),
        byVendor: [...byVendor.values()].sort(byAmount),
        rows,
      },
    });
  } catch (error) {
    logger.error('Claim Susut realized summary failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut realisation' } });
  }
};

export const getClaimSusutTree = async (req: AuthRequest, res: Response) => {
  try {
    const filters = claimSusutQueryFromReq(req);
    const result = await runClaimSusutCte(
      filters,
      'tree',
      `
      SELECT
        product,
        region_plant,
        incoterm,
        company,
        COALESCE(SUM(qty_claim), 0)::float8 AS qty_claim,
        COALESCE(SUM(amount_after_tax_idr), 0)::float8 AS amount_after_tax_idr
      FROM filtered
      GROUP BY 1, 2, 3, 4
      `,
    );
    const leaves = (result.rows || []) as ClaimSusutTreeLeaf[];
    const nodes = nestClaimSusutTree(leaves);
    return res.json({
      success: true,
      data: nodes,
      meta: { importId: filters.importId },
    });
  } catch (error) {
    logger.error('Claim Susut tree failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut drilldown' } });
  }
};

export const listClaimSusutRows = async (req: AuthRequest, res: Response) => {
  try {
    const filters = claimSusutQueryFromReq(req);
    const sortKeyRaw = String((req.query as any).sortKey || 'os_days').trim();
    const sortDirRaw = String((req.query as any).sortDir || 'desc').trim().toLowerCase();
    const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC';
    const limitRaw = parseInt(String((req.query as any).limit || '200'), 10);
    const offsetRaw = parseInt(String((req.query as any).offset || '0'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const SORT_SQL: Record<string, string> = {
      vendor_code: `vendor_code`,
      vendor_name: `vendor_name`,
      company: `company`,
      vendor_type: `vendor_type`,
      source: `source`,
      created_by: `created_by`,
      sta: `sta`,
      crno: `crno`,
      cr_date: `cr_date`,
      os_days: `os_days`,
      group_of_transport: `group_of_transport_norm`,
      payment_method: `payment_method`,
      dest: `dest`,
      region_plant: `region_plant`,
      incoterm: `incoterm`,
      po_number: `po_number`,
      contract_ext_no: `contract_ext_no`,
      comm: `comm`,
      commodity: `commodity`,
      product: `product`,
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

    const countRes = await runClaimSusutCte(
      filters,
      'rows',
      `SELECT COUNT(*)::int AS count FROM filtered`,
    );
    const totalCount = Number(countRes.rows?.[0]?.count) || 0;

    const base = buildClaimSusutFilteredCte(filters, 'rows');
    const limitIdx = base.params.length + 1;
    const offsetIdx = base.params.length + 2;
    const rowsRes = await query(
      `
      ${base.sql}
      SELECT
        id,
        vendor_code, vendor_name, company, vendor_type, source, created_by,
        sta, crno, cr_date, os_days,
        group_of_transport_norm AS group_of_transport, payment_method,
        dest, region_plant, incoterm, po_number, contract_ext_no,
        comm, commodity, product, uom, currency, company_code,
        remarks, type,
        qty_claim, amount_before_tax_idr, tax, amount_after_tax_idr,
        ${CLAIM_SUSUT_ROW_AGING_SQL},
        created_at
      FROM filtered
      ORDER BY ${orderBy}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      [...base.params, limit, offset],
    );

    return res.json({
      success: true,
      data: rowsRes.rows,
      meta: {
        totalCount,
        importId: filters.importId,
        limit,
        offset,
        sortKey,
        sortDir: sortDir.toLowerCase(),
      },
    });
  } catch (error) {
    logger.error('List Claim Susut rows failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut rows' } });
  }
};

export const listClaimSusutByGroupOfTransport = async (req: AuthRequest, res: Response) => {
  try {
    const filters = claimSusutQueryFromReq(req);
    const result = await runClaimSusutCte(
      filters,
      'group',
      `
      SELECT
        group_of_transport_norm AS group_of_transport,
        COALESCE(SUM(qty_claim), 0)::float8 AS qty_claim,
        ${CLAIM_SUSUT_AGING_SUM_SQL}
      FROM filtered
      GROUP BY 1
      ORDER BY grand_total DESC NULLS LAST, a_gt_90 DESC NULLS LAST, a_61_90 DESC NULLS LAST, a_31_60 DESC NULLS LAST, a_0_30 DESC NULLS LAST, group_of_transport ASC
      `,
    );

    return res.json({ success: true, data: result.rows, meta: { importId: filters.importId } });
  } catch (error) {
    logger.error('List Claim Susut by group of transport failed:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load Claim Susut by group of transport' } });
  }
};

