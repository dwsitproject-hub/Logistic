import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

export const getContracts = async (req: AuthRequest, res: Response) => {
  try {
    const { status, supplier, buyer, dateFrom, dateTo, outstanding, companyCode, b2bFlag, page = 1, limit = 10 } = req.query;
    const transportMode = (req.query as any).transportMode as string | undefined;
    const unassigned = (req.query as any).unassigned as string | undefined; // 'sea' | 'land' -> filter to SEA without shipments or LAND without trucking
    // Allow filtering by a specific contract id (used by shipment details fallback)
    const contractIdFilter = (req.query as any).contract_id || (req.query as any).contractId || null;
    const offset = (Number(page) - 1) * Number(limit);

    // Optimized: one CTE for latest sap_processed_data per contract, then reuse for all display fields (avoids 15+ correlated subqueries per row).
    let queryText = `
      WITH latest_spd AS (
        SELECT DISTINCT ON (contract_number) contract_number, data, created_at
        FROM sap_processed_data
        ORDER BY contract_number, created_at DESC NULLS LAST
      ),
      sto_agg AS (
        SELECT x.contract_number,
          STRING_AGG(DISTINCT x.effective_sto, ', ' ORDER BY x.effective_sto) AS sto_numbers,
          SUM(x.sto_quantity_num) AS total_sto_quantity,
          COUNT(DISTINCT x.effective_sto) AS sto_count
        FROM (
          SELECT spd.contract_number,
            NULLIF(TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number', spd.data->'shipment'->>'sto_no', spd.data->'contract'->>'sto_no')), '') AS effective_sto,
            CAST(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', '0'), ',', ''), ' ', '') AS NUMERIC) AS sto_quantity_num
          FROM sap_processed_data spd
          WHERE ((spd.sto_number IS NOT NULL AND spd.sto_number::text != '') OR NULLIF(TRIM(COALESCE(spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number', spd.data->'shipment'->>'sto_no', spd.data->'contract'->>'sto_no')), '') IS NOT NULL)
            AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        ) x
        WHERE x.effective_sto IS NOT NULL AND x.effective_sto != ''
        GROUP BY x.contract_number
      ),
      base AS (
        SELECT
          c.contract_id,
          (array_agg(c.id ORDER BY c.created_at DESC))[1] AS id,
          MAX(c.buyer) AS buyer,
          MAX(c.supplier) AS supplier,
          MAX(c.group_name) AS group_name,
          MAX(c.product) AS product,
          MAX(c.quantity_ordered) AS quantity_ordered,
          MAX(c.unit) AS unit,
          MAX(c.contract_date) AS contract_date,
          MAX(c.delivery_start_date) AS delivery_start_date,
          MAX(c.delivery_end_date) AS delivery_end_date,
          MAX(c.contract_value) AS contract_value,
          MAX(c.unit_price) AS unit_price,
          MAX(c.currency) AS currency,
          MAX(c.status) AS status,
          MAX(c.incoterm) AS incoterm,
          MAX(c.transport_mode) AS transport_mode,
          MAX(c.source_type) AS source_type,
          MAX(c.contract_type) AS contract_type,
          MAX(c.logistics_classification) AS logistics_classification,
          MAX(c.po_classification) AS po_classification,
          MAX(c.created_at) AS created_at,
          STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL AND c.po_number != '') AS po_numbers,
          MAX(c.sto_number) AS sto_number,
          (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1] AS latest_spd_data,
          (array_agg(s.sto_numbers ORDER BY s.total_sto_quantity DESC NULLS LAST))[1] AS sto_numbers_agg,
          (array_agg(s.total_sto_quantity ORDER BY s.total_sto_quantity DESC NULLS LAST))[1] AS total_sto_quantity,
          (array_agg(s.sto_count ORDER BY s.sto_count DESC NULLS LAST))[1] AS sto_count,
          COUNT(DISTINCT c.po_number) FILTER (WHERE c.po_number IS NOT NULL) AS po_count
        FROM contracts c
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        LEFT JOIN sto_agg s ON s.contract_number = c.contract_id
        WHERE 1=1
        GROUP BY c.contract_id
      )
      SELECT
        base.contract_id,
        base.id,
        base.buyer,
        base.supplier,
        base.group_name,
        base.product,
        base.quantity_ordered,
        base.unit,
        base.contract_date,
        base.delivery_start_date,
        base.delivery_end_date,
        base.contract_value,
        base.unit_price,
        base.currency,
        base.status,
        base.incoterm,
        COALESCE(NULLIF(TRIM(base.transport_mode), ''), base.latest_spd_data->'contract'->>'transport_mode', base.latest_spd_data->'contract'->>'sea_land', base.latest_spd_data->'raw'->>'Sea / Land', base.latest_spd_data->'raw'->>'Sea_Land', '') AS transport_mode,
        base.source_type,
        base.contract_type,
        base.logistics_classification,
        base.po_classification,
        base.created_at,
        base.po_numbers,
        base.sto_number,
        base.sto_numbers_agg AS sto_numbers,
        base.total_sto_quantity,
        (base.quantity_ordered - COALESCE(base.total_sto_quantity, 0))::numeric AS outstanding_quantity,
        base.po_count,
        base.sto_count,
        COALESCE(base.latest_spd_data->'contract'->>'company_code', base.latest_spd_data->'raw'->>'Company Code', base.latest_spd_data->'raw'->>'company code', base.latest_spd_data->>'Company Code', base.latest_spd_data->>'company code') AS company_code,
        COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag') AS b2b_flag,
        COALESCE(base.latest_spd_data->'contract'->>'contract_reference_po', base.latest_spd_data->>'CONTRACT REFF PO') AS contract_reference_po,
        COALESCE(base.latest_spd_data->'raw'->>'Contract Ext No', base.latest_spd_data->>'Contract Ext No') AS contract_ext_no,
        COALESCE(base.latest_spd_data->'contract'->>'ltc_spot', base.contract_type::text) AS lt_spot,
        base.latest_spd_data->'contract'->>'status' AS import_status,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'due_date_payment'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'Due Date Payment'), ''), NULLIF(trim(base.latest_spd_data->>'due date payment'), '')) AS due_date_payment_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'dp_date'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'DP Date'), ''), NULLIF(trim(base.latest_spd_data->>'dp date'), '')) AS dp_date_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'payoff_date'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'Payoff Date'), ''), NULLIF(trim(base.latest_spd_data->>'payoff date'), '')) AS payoff_date_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'dp_date_deviation_days'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'DP Date Deviation (Days) DP Date - Due Date'), '')) AS dp_date_deviation_raw,
        COALESCE(NULLIF(trim(base.latest_spd_data->'payment'->>'payoff_date_deviation_days'), ''), NULLIF(trim(base.latest_spd_data->'raw'->>'Payoff Date Deviation (Days) Payoff Date - Due Date'), '')) AS payoff_date_deviation_raw,
        (SELECT p.payment_due_date FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS due_date_payment_fb,
        (SELECT p.dp_date FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS dp_date_fb,
        (SELECT p.payoff_date FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS payoff_date_fb,
        (SELECT (p.dp_date::date - p.payment_due_date::date) FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id AND p.dp_date IS NOT NULL AND p.payment_due_date IS NOT NULL ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS dp_date_deviation_fb,
        (SELECT (p.payoff_date::date - p.payment_due_date::date) FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = base.contract_id AND p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL ORDER BY p.created_at DESC NULLS LAST LIMIT 1) AS payoff_date_deviation_fb,
        (SELECT COUNT(*) FROM trucking_operations t WHERE t.contract_id = base.id) AS trucking_count,
        (SELECT COUNT(*) FROM shipments s WHERE s.contract_id = base.id) AS shipment_count,
        (SELECT COUNT(*) FROM documents d WHERE d.contract_id = base.id) AS document_count
      FROM base
      WHERE 1=1
    `;
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (contractIdFilter) {
      queryText += ` AND base.contract_id = $${paramIndex}`;
      queryParams.push(contractIdFilter);
      paramIndex++;
    }

    const statusNorm = typeof status === 'string' ? status.trim() : '';
    if (statusNorm && statusNorm !== 'All Status' && statusNorm.toLowerCase() !== 'all') {
      if (statusNorm === 'Open' || statusNorm === 'ACTIVE') {
        queryText += ` AND (
          (base.latest_spd_data->'contract'->>'status' = 'Open' OR UPPER(base.latest_spd_data->'contract'->>'status') = 'ACTIVE')
          OR (base.latest_spd_data IS NULL AND base.status = 'ACTIVE')
        )`;
      } else if (statusNorm === 'Close' || statusNorm === 'CLOSE') {
        queryText += ` AND (
          (base.latest_spd_data->'contract'->>'status' = 'Close' OR UPPER(base.latest_spd_data->'contract'->>'status') IN ('CLOSE', 'COMPLETED', 'CLOSED'))
          OR (base.latest_spd_data IS NULL AND base.status IN ('CLOSE', 'COMPLETED', 'CLOSED'))
        )`;
      } else {
        queryText += ` AND (base.status = $${paramIndex} OR base.latest_spd_data->'contract'->>'status' = $${paramIndex})`;
        queryParams.push(statusNorm);
        paramIndex++;
      }
    }

    if (supplier) {
      queryText += ` AND base.supplier ILIKE $${paramIndex}`;
      queryParams.push(`%${supplier}%`);
      paramIndex++;
    }

    if (buyer) {
      queryText += ` AND base.buyer ILIKE $${paramIndex}`;
      queryParams.push(`%${buyer}%`);
      paramIndex++;
    }

    if (dateFrom) {
      queryText += ` AND base.contract_date >= $${paramIndex}`;
      queryParams.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      queryText += ` AND base.contract_date <= $${paramIndex}`;
      queryParams.push(dateTo);
      paramIndex++;
    }

    if (transportMode) {
      queryText += ` AND UPPER(base.transport_mode) = $${paramIndex}`;
      queryParams.push(String(transportMode).toUpperCase());
      paramIndex++;
    }

    if (companyCode) {
      queryText += ` AND (
        COALESCE(base.latest_spd_data->'contract'->>'company_code', base.latest_spd_data->'raw'->>'Company Code', base.latest_spd_data->'raw'->>'company code', base.latest_spd_data->>'Company Code', base.latest_spd_data->>'company code', '') = $${paramIndex}
      )`;
      queryParams.push(companyCode);
      paramIndex++;
    }

    if (b2bFlag) {
      queryText += ` AND (
        COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag', '') = $${paramIndex}
      )`;
      queryParams.push(b2bFlag);
      paramIndex++;
    }

    if (outstanding === 'true') {
      queryText += ` AND (base.quantity_ordered - COALESCE(base.total_sto_quantity, 0)) > 0`;
    }

    // Optional: delivered=true -> only contracts that have any STO quantity (delivered > 0)
    if ((req.query as any).delivered === 'true') {
      queryText += ` AND COALESCE(base.total_sto_quantity, 0) > 0`;
    }

    const effectiveTransportExpr = `UPPER(TRIM(COALESCE(NULLIF(TRIM(base.transport_mode), ''), base.latest_spd_data->'contract'->>'transport_mode', base.latest_spd_data->'contract'->>'sea_land', base.latest_spd_data->'raw'->>'Sea / Land', base.latest_spd_data->'raw'->>'Sea_Land', '')))`;
    if (unassigned === 'sea') {
      queryText += ` AND ${effectiveTransportExpr} LIKE 'SEA%' AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = base.id)`;
    } else if (unassigned === 'land') {
      queryText += ` AND ${effectiveTransportExpr} LIKE 'LAND%' AND NOT EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = base.id)`;
    }

    queryText += ` ORDER BY base.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(Number(limit), offset);

    const result = await query(queryText, queryParams);

    const due = (d: unknown): Date | null => {
      if (d == null) return null;
      if (d instanceof Date) return d;
      if (typeof d === 'string') return new Date(d);
      return null;
    };
    const parseDeviation = (s: unknown): number | null => {
      if (s == null) return null;
      if (typeof s === 'number' && Number.isInteger(s)) return s;
      if (typeof s === 'string') {
        const n = parseInt(s.trim(), 10);
        return Number.isNaN(n) ? null : n;
      }
      return null;
    };
    const addDays = (date: Date, days: number): Date => {
      const out = new Date(date);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };
    for (const row of result.rows) {
      row.due_date_payment = due(row.due_date_payment_raw) ?? due(row.due_date_payment_fb) ?? row.due_date_payment;
      row.dp_date = due(row.dp_date_raw) ?? due(row.dp_date_fb) ?? row.dp_date;
      row.payoff_date = due(row.payoff_date_raw) ?? due(row.payoff_date_fb) ?? row.payoff_date;
      row.dp_date_deviation_days = parseDeviation(row.dp_date_deviation_raw) ?? row.dp_date_deviation_fb ?? row.dp_date_deviation_days;
      row.payoff_date_deviation_days = parseDeviation(row.payoff_date_deviation_raw) ?? row.payoff_date_deviation_fb ?? row.payoff_date_deviation_days;
      const dueDate = due(row.due_date_payment);
      if (dueDate) {
        if (row.dp_date == null && typeof row.dp_date_deviation_days === 'number') {
          row.dp_date = addDays(dueDate, row.dp_date_deviation_days);
        }
        if (row.payoff_date == null && typeof row.payoff_date_deviation_days === 'number') {
          row.payoff_date = addDays(dueDate, row.payoff_date_deviation_days);
        }
      }
      delete (row as any).due_date_payment_raw;
      delete (row as any).dp_date_raw;
      delete (row as any).payoff_date_raw;
      delete (row as any).dp_date_deviation_raw;
      delete (row as any).payoff_date_deviation_raw;
      delete (row as any).due_date_payment_fb;
      delete (row as any).dp_date_fb;
      delete (row as any).payoff_date_fb;
      delete (row as any).dp_date_deviation_fb;
      delete (row as any).payoff_date_deviation_fb;
    }

    // Debug logging
    logger.info('Contracts query result:', { 
      rowsReturned: result.rows.length,
      firstRow: result.rows[0] ? {
        contract_id: result.rows[0].contract_id,
        sto_numbers: result.rows[0].sto_numbers,
        sto_count: result.rows[0].sto_count,
        total_sto_quantity: result.rows[0].total_sto_quantity
      } : null
    });

    // Get total count (count distinct contract_ids)
    let countQuery = ''
    const countParams: any[] = [];
    
    if (outstanding === 'true') {
      // For outstanding, we need to use a subquery with GROUP BY and HAVING
      countQuery = `
        SELECT COUNT(*) as count FROM (
          SELECT c.contract_id
          FROM contracts c
          WHERE 1=1
      `;
      let countParamIndex = 1;

      if (contractIdFilter) {
        countQuery += ` AND c.contract_id = $${countParamIndex}`;
        countParams.push(contractIdFilter);
        countParamIndex++;
      }
      
      const outStatusNorm = typeof status === 'string' ? status.trim() : '';
      if (outStatusNorm && outStatusNorm !== 'All Status' && outStatusNorm.toLowerCase() !== 'all') {
        if (outStatusNorm === 'Open' || outStatusNorm === 'ACTIVE') {
          countQuery += ` AND (
            EXISTS (
              SELECT 1 FROM sap_processed_data spd 
              WHERE spd.contract_number = c.contract_id 
              AND (spd.data->'contract'->>'status' = 'Open' OR UPPER(spd.data->'contract'->>'status') = 'ACTIVE')
              ORDER BY spd.created_at DESC LIMIT 1
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM sap_processed_data spd 
                WHERE spd.contract_number = c.contract_id
              )
              AND c.status = 'ACTIVE'
            )
          )`;
        } else if (outStatusNorm === 'Close' || outStatusNorm === 'CLOSE') {
          countQuery += ` AND (
            EXISTS (
              SELECT 1 FROM sap_processed_data spd 
              WHERE spd.contract_number = c.contract_id 
              AND (
                spd.data->'contract'->>'status' = 'Close' 
                OR UPPER(spd.data->'contract'->>'status') IN ('CLOSE', 'COMPLETED', 'CLOSED')
              )
              ORDER BY spd.created_at DESC LIMIT 1
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM sap_processed_data spd 
                WHERE spd.contract_number = c.contract_id
              )
              AND c.status IN ('CLOSE', 'COMPLETED', 'CLOSED')
            )
          )`;
        } else {
          countQuery += ` AND (c.status = $${countParamIndex} OR EXISTS (
            SELECT 1 FROM sap_processed_data spd 
            WHERE spd.contract_number = c.contract_id 
            AND spd.data->'contract'->>'status' = $${countParamIndex}
            ORDER BY spd.created_at DESC LIMIT 1
          ))`;
          countParams.push(outStatusNorm);
          countParamIndex++;
        }
      }

      if (supplier) {
        countQuery += ` AND c.supplier ILIKE $${countParamIndex}`;
        countParams.push(`%${supplier}%`);
        countParamIndex++;
      }

      if (buyer) {
        countQuery += ` AND c.buyer ILIKE $${countParamIndex}`;
        countParams.push(`%${buyer}%`);
        countParamIndex++;
      }

      if (transportMode) {
        countQuery += ` AND UPPER(c.transport_mode) = $${countParamIndex}`;
        countParams.push(String(transportMode).toUpperCase());
        countParamIndex++;
      }

      if (dateFrom) {
        countQuery += ` AND c.contract_date >= $${countParamIndex}`;
        countParams.push(dateFrom);
        countParamIndex++;
      }

      if (dateTo) {
        countQuery += ` AND c.contract_date <= $${countParamIndex}`;
        countParams.push(dateTo);
        countParamIndex++;
      }

      if (unassigned === 'sea') {
        countQuery += ` AND UPPER(TRIM(COALESCE(NULLIF(TRIM(c.transport_mode), ''), (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC LIMIT 1), (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC LIMIT 1), ''))) LIKE 'SEA%' AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = c.id)`;
      } else if (unassigned === 'land') {
        countQuery += ` AND UPPER(TRIM(COALESCE(NULLIF(TRIM(c.transport_mode), ''), (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC LIMIT 1), (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC LIMIT 1), ''))) LIKE 'LAND%' AND NOT EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = c.id)`;
      }
      
      countQuery += `
          GROUP BY c.contract_id
          HAVING COALESCE(MAX(c.quantity_ordered) - COALESCE((SELECT SUM(CAST(REPLACE(REPLACE(data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
             FROM sap_processed_data 
             WHERE contract_number = c.contract_id 
             AND sto_number IS NOT NULL 
             AND data->'contract'->>'sto_quantity' IS NOT NULL), 0), MAX(c.quantity_ordered)) > 0`;
      
      // Add company_code and b2b_flag filters for outstanding query
      if (companyCode) {
        countQuery += ` AND EXISTS (
          SELECT 1 FROM sap_processed_data spd 
          WHERE spd.contract_number = c.contract_id 
          AND (
            COALESCE(spd.data->'contract'->>'company_code', '') = $${countParamIndex}
            OR COALESCE(spd.data->'raw'->>'Company Code', '') = $${countParamIndex}
            OR COALESCE(spd.data->'raw'->>'company code', '') = $${countParamIndex}
            OR COALESCE(spd.data->>'Company Code', '') = $${countParamIndex}
            OR COALESCE(spd.data->>'company code', '') = $${countParamIndex}
          )
          ORDER BY spd.created_at DESC LIMIT 1
        )`;
        countParams.push(companyCode);
        countParamIndex++;
      }
      
      if (b2bFlag) {
        countQuery += ` AND EXISTS (
          SELECT 1 FROM sap_processed_data spd 
          WHERE spd.contract_number = c.contract_id 
          AND (
            COALESCE(spd.data->'contract'->>'contract_type', '') = $${countParamIndex}
            OR COALESCE(spd.data->>'B2B Flag', '') = $${countParamIndex}
          )
          ORDER BY spd.created_at DESC LIMIT 1
        )`;
        countParams.push(b2bFlag);
        countParamIndex++;
      }
      
      countQuery += `
        ) AS outstanding_contracts
      `;
    } else {
      countQuery = 'SELECT COUNT(DISTINCT c.contract_id) as count FROM contracts c WHERE 1=1';
      let countParamIndex = 1;

      if (contractIdFilter) {
        countQuery += ` AND c.contract_id = $${countParamIndex}`;
        countParams.push(contractIdFilter);
        countParamIndex++;
      }
      
      const countStatusNorm = typeof status === 'string' ? status.trim() : '';
      if (countStatusNorm && countStatusNorm !== 'All Status' && countStatusNorm.toLowerCase() !== 'all') {
        if (countStatusNorm === 'Open' || countStatusNorm === 'ACTIVE') {
          countQuery += ` AND (
            EXISTS (
              SELECT 1 FROM sap_processed_data spd 
              WHERE spd.contract_number = c.contract_id 
              AND (spd.data->'contract'->>'status' = 'Open' OR UPPER(spd.data->'contract'->>'status') = 'ACTIVE')
              ORDER BY spd.created_at DESC LIMIT 1
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM sap_processed_data spd 
                WHERE spd.contract_number = c.contract_id
              )
              AND c.status = 'ACTIVE'
            )
          )`;
        } else if (countStatusNorm === 'Close' || countStatusNorm === 'CLOSE') {
          countQuery += ` AND (
            EXISTS (
              SELECT 1 FROM sap_processed_data spd 
              WHERE spd.contract_number = c.contract_id 
              AND (
                spd.data->'contract'->>'status' = 'Close' 
                OR UPPER(spd.data->'contract'->>'status') IN ('CLOSE', 'COMPLETED', 'CLOSED')
              )
              ORDER BY spd.created_at DESC LIMIT 1
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM sap_processed_data spd 
                WHERE spd.contract_number = c.contract_id
              )
              AND c.status IN ('CLOSE', 'COMPLETED', 'CLOSED')
            )
          )`;
        } else {
          countQuery += ` AND (c.status = $${countParamIndex} OR EXISTS (
            SELECT 1 FROM sap_processed_data spd 
            WHERE spd.contract_number = c.contract_id 
            AND spd.data->'contract'->>'status' = $${countParamIndex}
            ORDER BY spd.created_at DESC LIMIT 1
          ))`;
          countParams.push(countStatusNorm);
          countParamIndex++;
        }
      }

      if (supplier) {
        countQuery += ` AND c.supplier ILIKE $${countParamIndex}`;
        countParams.push(`%${supplier}%`);
        countParamIndex++;
      }

      if (buyer) {
        countQuery += ` AND c.buyer ILIKE $${countParamIndex}`;
        countParams.push(`%${buyer}%`);
        countParamIndex++;
      }

      if (dateFrom) {
        countQuery += ` AND c.contract_date >= $${countParamIndex}`;
        countParams.push(dateFrom);
        countParamIndex++;
      }

      if (dateTo) {
        countQuery += ` AND c.contract_date <= $${countParamIndex}`;
        countParams.push(dateTo);
        countParamIndex++;
      }

      if (unassigned === 'sea') {
        countQuery += ` AND UPPER(TRIM(COALESCE(NULLIF(TRIM(c.transport_mode), ''), (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC LIMIT 1), (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC LIMIT 1), ''))) LIKE 'SEA%' AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = c.id)`;
      } else if (unassigned === 'land') {
        countQuery += ` AND UPPER(TRIM(COALESCE(NULLIF(TRIM(c.transport_mode), ''), (SELECT spd.data->'contract'->>'transport_mode' FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC LIMIT 1), (SELECT spd.data->'raw'->>'Sea / Land' FROM sap_processed_data spd WHERE spd.contract_number = c.contract_id ORDER BY spd.created_at DESC LIMIT 1), ''))) LIKE 'LAND%' AND NOT EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = c.id)`;
      }
      
      // For non-outstanding queries, we need GROUP BY if we have companyCode or b2bFlag filters
      if (companyCode || b2bFlag) {
        countQuery += ` GROUP BY c.contract_id`;
      }
      
      // Add company_code and b2b_flag filters to count query
      if (companyCode) {
        countQuery += ` HAVING EXISTS (
          SELECT 1 FROM sap_processed_data spd 
          WHERE spd.contract_number = c.contract_id 
          AND (
            COALESCE(spd.data->'contract'->>'company_code', '') = $${countParamIndex}
            OR COALESCE(spd.data->'raw'->>'Company Code', '') = $${countParamIndex}
            OR COALESCE(spd.data->'raw'->>'company code', '') = $${countParamIndex}
            OR COALESCE(spd.data->>'Company Code', '') = $${countParamIndex}
            OR COALESCE(spd.data->>'company code', '') = $${countParamIndex}
          )
          ORDER BY spd.created_at DESC LIMIT 1
        )`;
        countParams.push(companyCode);
        countParamIndex++;
      }
      
      if (b2bFlag) {
        countQuery += ` HAVING EXISTS (
          SELECT 1 FROM sap_processed_data spd 
          WHERE spd.contract_number = c.contract_id 
          AND (
            COALESCE(spd.data->'contract'->>'contract_type', '') = $${countParamIndex}
            OR COALESCE(spd.data->>'B2B Flag', '') = $${countParamIndex}
          )
          ORDER BY spd.created_at DESC LIMIT 1
        )`;
        countParams.push(b2bFlag);
        countParamIndex++;
      }
    }

    const countResult = await query(countQuery, countParams);

    res.json({
      success: true,
      data: {
        contracts: result.rows,
        pagination: {
          total: parseInt(countResult.rows[0].count),
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(parseInt(countResult.rows[0].count) / Number(limit)),
        },
      },
    });
  } catch (error) {
    logger.error('Get contracts error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contracts' },
    });
  }
};

/** Get counts of SEA contracts without shipments and LAND contracts without trucking (for dashboard cards) */
export const getUnassignedCounts = async (_req: AuthRequest, res: Response) => {
  try {
    const q = `
      WITH latest_spd AS (
        SELECT DISTINCT ON (contract_number) contract_number, data, created_at
        FROM sap_processed_data
        ORDER BY contract_number, created_at DESC NULLS LAST
      ),
      base AS (
        SELECT
          c.contract_id,
          (array_agg(c.id ORDER BY c.created_at DESC))[1] AS id,
          COALESCE(NULLIF(TRIM(MAX(c.transport_mode)), ''), (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'contract'->>'transport_mode', (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'contract'->>'sea_land', (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'raw'->>'Sea / Land', (array_agg(l.data ORDER BY l.created_at DESC NULLS LAST))[1]->'raw'->>'Sea_Land', '') AS effective_transport_mode
        FROM contracts c
        LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
        GROUP BY c.contract_id
      ),
      sea_no_ship AS (
        SELECT 1
        FROM base b
        WHERE UPPER(TRIM(b.effective_transport_mode)) LIKE 'SEA%'
          AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.contract_id = b.id)
      ),
      land_no_truck AS (
        SELECT 1
        FROM base b
        WHERE UPPER(TRIM(b.effective_transport_mode)) LIKE 'LAND%'
          AND NOT EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = b.id)
      )
      SELECT
        (SELECT COUNT(*) FROM sea_no_ship) AS sea_without_shipments,
        (SELECT COUNT(*) FROM land_no_truck) AS land_without_trucking
    `;
    const result = await query(q);
    const row = result.rows[0] || { sea_without_shipments: 0, land_without_trucking: 0 };
    res.json({
      success: true,
      data: {
        seaWithoutShipments: parseInt(String(row.sea_without_shipments), 10) || 0,
        landWithoutTrucking: parseInt(String(row.land_without_trucking), 10) || 0,
      },
    });
  } catch (error) {
    logger.error('Get unassigned counts error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch unassigned counts' },
    });
  }
};

export const getContract = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('SELECT * FROM contracts WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Contract not found' },
      });
    }

    // Get related shipments
    const shipmentsResult = await query(
      'SELECT * FROM shipments WHERE contract_id = $1 ORDER BY created_at DESC',
      [id]
    );

    // Get related payments
    const paymentsResult = await query(
      'SELECT * FROM payments WHERE contract_id = $1 ORDER BY created_at DESC',
      [id]
    );

    return res.json({
      success: true,
      data: {
        contract: result.rows[0],
        shipments: shipmentsResult.rows,
        payments: paymentsResult.rows,
      },
    });
  } catch (error) {
    logger.error('Get contract error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract' },
    });
  }
};

/** Get STO information for a contract (shipment and trucking STOs) for detail view */
export const getContractStoInformation = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const contractResult = await query('SELECT id, contract_id, delivery_end_date, transport_mode FROM contracts WHERE id = $1', [id]);
    if (contractResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Contract not found' } });
    }
    const contract = contractResult.rows[0];
    const deliveryEnd = contract.delivery_end_date ? new Date(contract.delivery_end_date) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const computeLateIndicator = (endDate: Date | null, ataDate: string | null, etaDate: string | null): string => {
      if (!endDate) return '-';
      const end = new Date(endDate);
      end.setHours(0, 0, 0, 0);
      if (ataDate) {
        const ata = new Date(ataDate);
        ata.setHours(0, 0, 0, 0);
        if (end < ata) return 'Late';
      }
      if (etaDate) {
        const eta = new Date(etaDate);
        eta.setHours(0, 0, 0, 0);
        if (end < eta) return 'Late';
      }
      if (end < today) return 'Late';
      return 'On Time';
    };

    // Shipment STOs: group by sto_key (COALESCE(contract.sto_number, operation_id, shipment_id))
    const shipmentStosQuery = `
      WITH shipment_base AS (
        SELECT
          COALESCE(c.sto_number, s.operation_id, s.shipment_id) AS sto_key,
          MAX(c.sto_number) AS sto_number,
          MAX(s.operation_id) AS operation_id,
          MAX(s.status) AS status,
          COALESCE(SUM(s.quantity_delivered), 0) AS quantity_delivered,
          MAX(s.vessel_name) AS vessel_name,
          MAX(s.ata_discharge_complete) AS ata_discharge_complete,
          MAX(s.eta_discharge_complete) AS eta_discharge_complete,
          MAX((SELECT vlp.eta_vessel_arrival::date FROM vessel_loading_ports vlp WHERE vlp.shipment_id = s.id AND vlp.is_discharge_port = false ORDER BY vlp.port_sequence ASC LIMIT 1)) AS eta_loading_port
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        WHERE s.contract_id = $1
        GROUP BY COALESCE(c.sto_number, s.operation_id, s.shipment_id)
      )
      SELECT
        sb.sto_key,
        sb.sto_number,
        sb.operation_id,
        sb.status,
        COALESCE((SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE spd.sto_number = sb.sto_key AND spd.data->'contract'->>'sto_quantity' IS NOT NULL), 0) AS sto_quantity,
        sb.quantity_delivered,
        sb.vessel_name,
        sb.eta_loading_port AS eta_vessel_arrival_loading_port,
        sb.ata_discharge_complete,
        sb.eta_discharge_complete
      FROM shipment_base sb
      ORDER BY sb.sto_key
    `;
    const shipmentRows = await query(shipmentStosQuery, [id]);

    // Trucking STOs: one row per trucking operation
    const truckingStosQuery = `
      SELECT
        COALESCE(c.sto_number, t.operation_id::text, t.id::text) AS sto_number,
        t.operation_id,
        t.status,
        c.quantity_ordered AS sto_quantity,
        t.quantity_delivered AS quantity_receive,
        t.trucking_owner,
        t.eta_trucking_completion_date,
        t.trucking_completion_date
      FROM trucking_operations t
      LEFT JOIN contracts c ON t.contract_id = c.id
      WHERE t.contract_id = $1
      ORDER BY t.created_at DESC
    `;
    const truckingRows = await query(truckingStosQuery, [id]);

    const shipmentStos = shipmentRows.rows.map((r: any) => {
      const lateIndicator = computeLateIndicator(
        deliveryEnd,
        r.ata_discharge_complete,
        r.eta_discharge_complete
      );
      return {
        type: 'shipment',
        sto_number: r.sto_number || r.sto_key || '-',
        operation_id: r.operation_id || r.sto_key || null,
        late_indicator: lateIndicator,
        status: r.status || '-',
        sto_quantity: Number(r.sto_quantity) || 0,
        quantity_delivered: Number(r.quantity_delivered) || 0,
        vessel_name: r.vessel_name || '-',
        eta_vessel_arrival_loading_port: r.eta_vessel_arrival_loading_port || null,
      };
    });

    const truckingStos = truckingRows.rows.map((r: any) => {
      const lateIndicator = computeLateIndicator(
        deliveryEnd,
        r.trucking_completion_date,
        r.eta_trucking_completion_date
      );
      return {
        type: 'trucking',
        sto_number: r.sto_number || '-',
        operation_id: r.operation_id || null,
        late_indicator: lateIndicator,
        status: r.status || '-',
        sto_quantity: Number(r.sto_quantity) || 0,
        quantity_receive: Number(r.quantity_receive) || 0,
        trucking_owner: r.trucking_owner || '-',
        eta_trucking_completion_date: r.eta_trucking_completion_date || null,
      };
    });

    const stos = [...shipmentStos, ...truckingStos];
    return res.json({ success: true, data: { stos } });
  } catch (error) {
    logger.error('Get contract STO information error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch STO information' },
    });
  }
};

/** Get activity log for a contract: changes to contract, STO (shipments, trucking, loading ports), documents, payments */
export const getContractActivityLog = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const contractCheck = await query('SELECT id FROM contracts WHERE id = $1', [id]);
    if (contractCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Contract not found' } });
    }

    const result = await query(
      `SELECT
         a.id,
         a.action,
         a.entity_type,
         a.entity_id,
         a.before_data,
         a.after_data,
         a.timestamp,
         u.username,
         u.full_name
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE (
         (a.entity_type = 'CONTRACT' AND a.entity_id = $1)
         OR (a.entity_type = 'SHIPMENT' AND a.entity_id IN (SELECT id FROM shipments WHERE contract_id = $1))
         OR (a.entity_type = 'TRUCKING_OPERATION' AND a.entity_id IN (SELECT id FROM trucking_operations WHERE contract_id = $1))
         OR (a.entity_type = 'PAYMENT' AND a.entity_id IN (SELECT id FROM payments WHERE contract_id = $1))
         OR (a.entity_type = 'DOCUMENT' AND a.entity_id IN (SELECT id FROM documents WHERE contract_id = $1))
         OR (a.entity_type = 'LOADING_PORT' AND a.entity_id IN (SELECT vlp.id FROM vessel_loading_ports vlp JOIN shipments s ON s.id = vlp.shipment_id WHERE s.contract_id = $1))
       )
       ORDER BY a.timestamp DESC
       LIMIT 200`,
      [id]
    );

    const logs = result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      before_data: row.before_data,
      after_data: row.after_data,
      timestamp: row.timestamp,
      username: row.username || row.full_name || 'System',
      full_name: row.full_name,
    }));

    return res.json({ success: true, data: logs });
  } catch (error) {
    logger.error('Get contract activity log error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load activity log' } });
  }
};

export const createContract = async (req: AuthRequest, res: Response) => {
  try {
    const {
      contract_id,
      buyer,
      supplier,
      product,
      quantity_ordered,
      unit,
      incoterm,
      loading_site,
      unloading_site,
      contract_date,
      delivery_start_date,
      delivery_end_date,
      contract_value,
      currency,
      sap_contract_id,
    } = req.body;

    const result = await query(
      `INSERT INTO contracts (
        contract_id, buyer, supplier, product, quantity_ordered, unit, incoterm,
        loading_site, unloading_site, contract_date, delivery_start_date,
        delivery_end_date, contract_value, currency, sap_contract_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        contract_id,
        buyer,
        supplier,
        product,
        quantity_ordered,
        unit,
        incoterm,
        loading_site,
        unloading_site,
        contract_date,
        delivery_start_date,
        delivery_end_date,
        contract_value,
        currency,
        sap_contract_id,
        req.user?.id,
      ]
    );

    logger.info(`Contract created: ${contract_id} by ${req.user?.username}`);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Create contract error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create contract' },
    });
  }
};

export const updateContract = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');

    const values = [id, ...Object.values(updates)];

    const result = await query(
      `UPDATE contracts SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Contract not found' },
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Update contract error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to update contract' },
    });
  }
};

