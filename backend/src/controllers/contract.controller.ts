import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

export const getContracts = async (req: AuthRequest, res: Response) => {
  try {
    const { status, supplier, buyer, dateFrom, dateTo, outstanding, companyCode, b2bFlag, page = 1, limit = 10 } = req.query;
    // Allow filtering by a specific contract id (used by shipment details fallback)
    const contractIdFilter = (req.query as any).contract_id || (req.query as any).contractId || null;
    const offset = (Number(page) - 1) * Number(limit);

    // Updated query to group contracts by contract_id
    // Outstanding Quantity = Contract Quantity - Total STO Quantity from contracts table
    // STO Numbers come from sap_processed_data table via subquery
    let queryText = `
      SELECT 
        c.contract_id,
        (array_agg(c.id ORDER BY c.created_at DESC))[1] as id,
        MAX(c.buyer) as buyer,
        MAX(c.supplier) as supplier,
        MAX(c.group_name) as group_name,
        MAX(c.product) as product,
        MAX(c.quantity_ordered) as quantity_ordered,
        MAX(c.unit) as unit,
        MAX(c.contract_date) as contract_date,
        MAX(c.delivery_start_date) as delivery_start_date,
        MAX(c.delivery_end_date) as delivery_end_date,
        MAX(c.contract_value) as contract_value,
        MAX(c.unit_price) as unit_price,
        MAX(c.currency) as currency,
        MAX(c.status) as status,
        MAX(c.incoterm) as incoterm,
        MAX(c.transport_mode) as transport_mode,
        MAX(c.source_type) as source_type,
        MAX(c.contract_type) as contract_type,
        MAX(c.logistics_classification) as logistics_classification,
        MAX(c.po_classification) as po_classification,
        MAX(c.created_at) as created_at,
        STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL AND c.po_number != '') as po_numbers,
        (SELECT STRING_AGG(DISTINCT sto_number, ', ' ORDER BY sto_number) 
         FROM sap_processed_data 
         WHERE contract_number = c.contract_id AND sto_number IS NOT NULL AND sto_number != '') as sto_numbers,
        COALESCE((SELECT SUM(CAST(REPLACE(REPLACE(data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
         FROM sap_processed_data 
         WHERE contract_number = c.contract_id 
         AND sto_number IS NOT NULL 
         AND data->'contract'->>'sto_quantity' IS NOT NULL), 0) as total_sto_quantity,
        COALESCE(MAX(c.quantity_ordered) - COALESCE((SELECT SUM(CAST(REPLACE(REPLACE(data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
         FROM sap_processed_data 
         WHERE contract_number = c.contract_id 
         AND sto_number IS NOT NULL 
         AND data->'contract'->>'sto_quantity' IS NOT NULL), 0), MAX(c.quantity_ordered)) as outstanding_quantity,
        COUNT(DISTINCT c.po_number) FILTER (WHERE c.po_number IS NOT NULL) as po_count,
        (SELECT COUNT(DISTINCT sto_number) 
         FROM sap_processed_data 
         WHERE contract_number = c.contract_id AND sto_number IS NOT NULL) as sto_count,
        -- Latest processed row JSON for this contract (for display-only fields)
        (SELECT COALESCE(
                  spd.data->'contract'->>'company_code',
                  spd.data->'raw'->>'Company Code',
                  spd.data->'raw'->>'company code',
                  spd.data->>'Company Code',
                  spd.data->>'company code'
                )
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS company_code,
        (SELECT COALESCE(
                  spd.data->'contract'->>'contract_type',         -- normalized from 'B2B Flag'
                  spd.data->>'B2B Flag'
                )
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS b2b_flag,
        (SELECT COALESCE(
                  spd.data->'contract'->>'contract_reference_po',
                  spd.data->>'CONTRACT REFF PO'
                )
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS contract_reference_po,
        -- LT/SPOT display (prefer normalized ltc_spot from JSON if present, else contract_type column)
        (SELECT COALESCE(
                  spd.data->'contract'->>'ltc_spot',
                  MAX(c.contract_type)::text
                )
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS lt_spot,
        -- Status from import JSON for display (does not override DB enum)
        (SELECT spd.data->'contract'->>'status'
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1) AS import_status,
        -- Payment dates: SAP data (payment + raw keys). Support ISO, DD.MM.YYYY, YYYY/MM/DD, DD/MM/YYYY, "16 May 2025" (DD Mon YYYY), "16 January 2025" (DD Month YYYY).
        COALESCE(
          (SELECT (
              CASE
                WHEN trim(v.val) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.val)::date
                WHEN trim(v.val) ~ '^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.[0-9]{4}$' THEN to_date(trim(v.val), 'DD.MM.YYYY')
                WHEN trim(v.val) ~ '^[0-9]{4}/(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])$' THEN to_date(trim(v.val), 'YYYY/MM/DD')
                WHEN trim(v.val) ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}$' THEN to_date(trim(v.val), 'DD/MM/YYYY')
                WHEN trim(v.val) ~ '^(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])/[0-9]{4}$' THEN to_date(trim(v.val), 'MM/DD/YYYY')
                WHEN trim(v.val) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.val), 'MM/DD/YY')
                WHEN regexp_replace(trim(v.val), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$' THEN to_date(regexp_replace(trim(v.val), '\s+', ' ', 'g'), 'DD Mon YYYY')
                WHEN regexp_replace(trim(v.val), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{4,9} [0-9]{4}$' THEN to_date(regexp_replace(trim(v.val), '\s+', ' ', 'g'), 'DD Month YYYY')
                WHEN trim(v.val) ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$' THEN to_date(trim(v.val), 'DD-Mon-YYYY')
                ELSE NULL
              END
            )
             FROM (
               SELECT COALESCE(
                 NULLIF(trim(x.data->'payment'->>'due_date_payment'), ''),
                 NULLIF(trim(x.data->>'due date payment'), ''),
                 NULLIF(trim(x.data->'raw'->>'Due Date Payment'), ''),
                 NULLIF(trim(x.data->'raw'->>'due date payment'), ''),
                 (SELECT e.v FROM jsonb_each_text(x.data->'raw') AS e(k,v) WHERE lower(replace(trim(e.k), ' ', '')) = 'duedatepayment' AND trim(e.v) <> '' LIMIT 1)
               ) AS val
               FROM (SELECT data FROM sap_processed_data WHERE contract_number = c.contract_id
                 ORDER BY (CASE WHEN trim(COALESCE(data->'raw'->>'Due Date Payment', data->'payment'->>'due_date_payment', '')) <> '' THEN 0 ELSE 1 END), (CASE WHEN trim(COALESCE(data->'raw'->>'DP Date', data->'payment'->>'dp_date', '')) <> '' THEN 0 ELSE 1 END), (CASE WHEN trim(COALESCE(data->'raw'->>'Payoff Date', data->'payment'->>'payoff_date', '')) <> '' THEN 0 ELSE 1 END), created_at DESC NULLS LAST LIMIT 1) x
             ) v
             WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
             LIMIT 1),
          (SELECT p.payment_due_date FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = c.contract_id ORDER BY p.created_at DESC NULLS LAST LIMIT 1)
        ) AS due_date_payment,
        COALESCE(
          (SELECT (
              CASE
                WHEN trim(v.val) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.val)::date
                WHEN trim(v.val) ~ '^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.[0-9]{4}$' THEN to_date(trim(v.val), 'DD.MM.YYYY')
                WHEN trim(v.val) ~ '^[0-9]{4}/(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])$' THEN to_date(trim(v.val), 'YYYY/MM/DD')
                WHEN trim(v.val) ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}$' THEN to_date(trim(v.val), 'DD/MM/YYYY')
                WHEN trim(v.val) ~ '^(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])/[0-9]{4}$' THEN to_date(trim(v.val), 'MM/DD/YYYY')
                WHEN trim(v.val) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.val), 'MM/DD/YY')
                WHEN regexp_replace(trim(v.val), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$' THEN to_date(regexp_replace(trim(v.val), '\s+', ' ', 'g'), 'DD Mon YYYY')
                WHEN regexp_replace(trim(v.val), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{4,9} [0-9]{4}$' THEN to_date(regexp_replace(trim(v.val), '\s+', ' ', 'g'), 'DD Month YYYY')
                WHEN trim(v.val) ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$' THEN to_date(trim(v.val), 'DD-Mon-YYYY')
                ELSE NULL
              END
            )
             FROM (
               SELECT COALESCE(
                 NULLIF(trim(x.data->'payment'->>'dp_date'), ''),
                 NULLIF(trim(x.data->'payment'->>'DP Date'), ''),
                 NULLIF(trim(x.data->>'dp date'), ''),
                 NULLIF(trim(x.data->>'DP Date'), ''),
                 NULLIF(trim(x.data->'raw'->>'DP Date'), ''),
                 NULLIF(trim(x.data->'raw'->>'dp date'), ''),
                 NULLIF(trim(x.data->'raw'->>'D.P. Date'), ''),
                 NULLIF(trim(x.data->'raw'->>'DPDate'), ''),
                 NULLIF(trim(x.data->'raw'->>'dp_date'), ''),
                 (SELECT e.v FROM jsonb_each_text(x.data->'raw') AS e(k,v) WHERE lower(replace(trim(e.k), ' ', '')) = 'dpdate' AND trim(e.v) <> '' LIMIT 1)
               ) AS val
               FROM (SELECT data FROM sap_processed_data WHERE contract_number = c.contract_id
                 ORDER BY (CASE WHEN trim(COALESCE(data->'raw'->>'Due Date Payment', data->'payment'->>'due_date_payment', '')) <> '' THEN 0 ELSE 1 END), (CASE WHEN trim(COALESCE(data->'raw'->>'DP Date', data->'payment'->>'dp_date', '')) <> '' THEN 0 ELSE 1 END), (CASE WHEN trim(COALESCE(data->'raw'->>'Payoff Date', data->'payment'->>'payoff_date', '')) <> '' THEN 0 ELSE 1 END), created_at DESC NULLS LAST LIMIT 1) x
             ) v
             WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
             LIMIT 1),
          (SELECT p.dp_date FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = c.contract_id ORDER BY p.created_at DESC NULLS LAST LIMIT 1)
        ) AS dp_date,
        COALESCE(
          (SELECT (
              CASE
                WHEN trim(v.val) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.val)::date
                WHEN trim(v.val) ~ '^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.[0-9]{4}$' THEN to_date(trim(v.val), 'DD.MM.YYYY')
                WHEN trim(v.val) ~ '^[0-9]{4}/(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])$' THEN to_date(trim(v.val), 'YYYY/MM/DD')
                WHEN trim(v.val) ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}$' THEN to_date(trim(v.val), 'DD/MM/YYYY')
                WHEN trim(v.val) ~ '^(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])/[0-9]{4}$' THEN to_date(trim(v.val), 'MM/DD/YYYY')
                WHEN trim(v.val) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.val), 'MM/DD/YY')
                WHEN regexp_replace(trim(v.val), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$' THEN to_date(regexp_replace(trim(v.val), '\s+', ' ', 'g'), 'DD Mon YYYY')
                WHEN regexp_replace(trim(v.val), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{4,9} [0-9]{4}$' THEN to_date(regexp_replace(trim(v.val), '\s+', ' ', 'g'), 'DD Month YYYY')
                WHEN trim(v.val) ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$' THEN to_date(trim(v.val), 'DD-Mon-YYYY')
                ELSE NULL
              END
            )
             FROM (
               SELECT COALESCE(
                 NULLIF(trim(x.data->'payment'->>'payoff_date'), ''),
                 NULLIF(trim(x.data->'payment'->>'Payoff Date'), ''),
                 NULLIF(trim(x.data->>'payoff date'), ''),
                 NULLIF(trim(x.data->>'Payoff Date'), ''),
                 NULLIF(trim(x.data->'raw'->>'Payoff Date'), ''),
                 NULLIF(trim(x.data->'raw'->>'payoff date'), ''),
                 NULLIF(trim(x.data->'raw'->>'PayoffDate'), ''),
                 NULLIF(trim(x.data->'raw'->>'payoff_date'), ''),
                 (SELECT e.v FROM jsonb_each_text(x.data->'raw') AS e(k,v) WHERE lower(replace(trim(e.k), ' ', '')) = 'payoffdate' AND trim(e.v) <> '' LIMIT 1)
               ) AS val
               FROM (SELECT data FROM sap_processed_data WHERE contract_number = c.contract_id
                 ORDER BY (CASE WHEN trim(COALESCE(data->'raw'->>'Due Date Payment', data->'payment'->>'due_date_payment', '')) <> '' THEN 0 ELSE 1 END), (CASE WHEN trim(COALESCE(data->'raw'->>'DP Date', data->'payment'->>'dp_date', '')) <> '' THEN 0 ELSE 1 END), (CASE WHEN trim(COALESCE(data->'raw'->>'Payoff Date', data->'payment'->>'payoff_date', '')) <> '' THEN 0 ELSE 1 END), created_at DESC NULLS LAST LIMIT 1) x
             ) v
             WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
             LIMIT 1),
          (SELECT p.payoff_date FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = c.contract_id ORDER BY p.created_at DESC NULLS LAST LIMIT 1)
        ) AS payoff_date,
        -- DP Date Deviation (Days) = DP Date - Due Date Payment: use stored integer or compute from dates
        COALESCE(
          (SELECT (
              CASE
                WHEN v.dev_tex ~ '^-?[0-9]+$' THEN (v.dev_tex)::int
                WHEN v.dp ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND v.due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN v.dp::date - v.due::date
                WHEN v.dp ~ '^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.[0-9]{4}$' AND v.due ~ '^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.[0-9]{4}$'
                  THEN to_date(v.dp, 'DD.MM.YYYY') - to_date(v.due, 'DD.MM.YYYY')
                WHEN v.dp ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}$' AND v.due ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}$'
                  THEN to_date(v.dp, 'DD/MM/YYYY') - to_date(v.due, 'DD/MM/YYYY')
                WHEN v.dp ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' AND v.due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$'
                  THEN to_date(v.dp, 'MM/DD/YY') - to_date(v.due, 'MM/DD/YY')
                WHEN v.dp ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$' AND v.due ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$'
                  THEN to_date(v.dp, 'DD Mon YYYY') - to_date(v.due, 'DD Mon YYYY')
                WHEN regexp_replace(trim(v.dp), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$' AND regexp_replace(trim(v.due), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$'
                  THEN to_date(regexp_replace(trim(v.dp), '\s+', ' ', 'g'), 'DD Mon YYYY') - to_date(regexp_replace(trim(v.due), '\s+', ' ', 'g'), 'DD Mon YYYY')
                WHEN v.dp ~ '^[0-9]{1,2} [A-Za-z]{4,9} [0-9]{4}$' AND v.due ~ '^[0-9]{1,2} [A-Za-z]{4,9} [0-9]{4}$'
                  THEN to_date(v.dp, 'DD Month YYYY') - to_date(v.due, 'DD Month YYYY')
                WHEN v.dp ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$' AND v.due ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$'
                  THEN to_date(v.dp, 'DD-Mon-YYYY') - to_date(v.due, 'DD-Mon-YYYY')
                ELSE NULL
              END
            )
             FROM (
               SELECT
                 COALESCE(NULLIF(trim(spd.data->'payment'->>'dp_date'), ''), NULLIF(trim(spd.data->'payment'->>'DP Date'), ''), NULLIF(trim(spd.data->>'dp date'), ''), NULLIF(trim(spd.data->>'DP Date'), ''), NULLIF(trim(spd.data->'raw'->>'DP Date'), ''), NULLIF(trim(spd.data->'raw'->>'dp date'), ''), NULLIF(trim(spd.data->'raw'->>'D.P. Date'), ''), NULLIF(trim(spd.data->'raw'->>'DPDate'), ''), NULLIF(trim(spd.data->'raw'->>'dp_date'), '')) AS dp,
                 COALESCE(NULLIF(trim(spd.data->'payment'->>'due_date_payment'), ''), NULLIF(trim(spd.data->>'due date payment'), ''), NULLIF(trim(spd.data->'raw'->>'Due Date Payment'), ''), NULLIF(trim(spd.data->'raw'->>'due date payment'), '')) AS due,
                 COALESCE(NULLIF(trim(spd.data->'payment'->>'dp_date_deviation_days'), ''), NULLIF(trim(spd.data->'raw'->>'DP Date Deviation (Days) DP Date - Due Date'), ''), NULLIF(trim(spd.data->'raw'->>'DP Date - Due Date'), '')) AS dev_tex
               FROM sap_processed_data spd
               WHERE spd.contract_number = c.contract_id
               ORDER BY spd.created_at DESC NULLS LAST
               LIMIT 1
             ) v
             WHERE (v.dev_tex IS NOT NULL AND trim(v.dev_tex) <> '' AND v.dev_tex ~ '^-?[0-9]+$')
                OR (length(trim(v.dp)) >= 6 AND length(trim(v.due)) >= 6)
             LIMIT 1),
          (SELECT (p.dp_date::date - p.payment_due_date::date)
             FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = c.contract_id AND p.dp_date IS NOT NULL AND p.payment_due_date IS NOT NULL ORDER BY p.created_at DESC NULLS LAST LIMIT 1)
        ) AS dp_date_deviation_days,
        -- Payoff Date Deviation (Days) = Payoff Date - Due Date Payment: use stored integer or compute from dates
        COALESCE(
          (SELECT (
              CASE
                WHEN v.dev_tex ~ '^-?[0-9]+$' THEN (v.dev_tex)::int
                WHEN v.pay ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND v.due ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN v.pay::date - v.due::date
                WHEN v.pay ~ '^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.[0-9]{4}$' AND v.due ~ '^(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.[0-9]{4}$'
                  THEN to_date(v.pay, 'DD.MM.YYYY') - to_date(v.due, 'DD.MM.YYYY')
                WHEN v.pay ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}$' AND v.due ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}$'
                  THEN to_date(v.pay, 'DD/MM/YYYY') - to_date(v.due, 'DD/MM/YYYY')
                WHEN v.pay ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' AND v.due ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$'
                  THEN to_date(v.pay, 'MM/DD/YY') - to_date(v.due, 'MM/DD/YY')
                WHEN v.pay ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$' AND v.due ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$'
                  THEN to_date(v.pay, 'DD Mon YYYY') - to_date(v.due, 'DD Mon YYYY')
                WHEN regexp_replace(trim(v.pay), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$' AND regexp_replace(trim(v.due), '\s+', ' ', 'g') ~ '^[0-9]{1,2} [A-Za-z]{3} [0-9]{4}$'
                  THEN to_date(regexp_replace(trim(v.pay), '\s+', ' ', 'g'), 'DD Mon YYYY') - to_date(regexp_replace(trim(v.due), '\s+', ' ', 'g'), 'DD Mon YYYY')
                WHEN v.pay ~ '^[0-9]{1,2} [A-Za-z]{4,9} [0-9]{4}$' AND v.due ~ '^[0-9]{1,2} [A-Za-z]{4,9} [0-9]{4}$'
                  THEN to_date(v.pay, 'DD Month YYYY') - to_date(v.due, 'DD Month YYYY')
                WHEN v.pay ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$' AND v.due ~ '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}$'
                  THEN to_date(v.pay, 'DD-Mon-YYYY') - to_date(v.due, 'DD-Mon-YYYY')
                ELSE NULL
              END
            )
             FROM (
               SELECT
                 COALESCE(NULLIF(trim(spd.data->'payment'->>'payoff_date'), ''), NULLIF(trim(spd.data->'payment'->>'Payoff Date'), ''), NULLIF(trim(spd.data->>'payoff date'), ''), NULLIF(trim(spd.data->>'Payoff Date'), ''), NULLIF(trim(spd.data->'raw'->>'Payoff Date'), ''), NULLIF(trim(spd.data->'raw'->>'payoff date'), ''), NULLIF(trim(spd.data->'raw'->>'PayoffDate'), ''), NULLIF(trim(spd.data->'raw'->>'payoff_date'), '')) AS pay,
                 COALESCE(NULLIF(trim(spd.data->'payment'->>'due_date_payment'), ''), NULLIF(trim(spd.data->>'due date payment'), ''), NULLIF(trim(spd.data->'raw'->>'Due Date Payment'), ''), NULLIF(trim(spd.data->'raw'->>'due date payment'), '')) AS due,
                 COALESCE(NULLIF(trim(spd.data->'payment'->>'payoff_date_deviation_days'), ''), NULLIF(trim(spd.data->'raw'->>'Payoff Date Deviation (Days) Payoff Date - Due Date'), ''), NULLIF(trim(spd.data->'raw'->>'Payoff Date - Due Date'), '')) AS dev_tex
               FROM sap_processed_data spd
               WHERE spd.contract_number = c.contract_id
               ORDER BY spd.created_at DESC NULLS LAST
               LIMIT 1
             ) v
             WHERE (v.dev_tex IS NOT NULL AND trim(v.dev_tex) <> '' AND v.dev_tex ~ '^-?[0-9]+$')
                OR (length(trim(v.pay)) >= 6 AND length(trim(v.due)) >= 6)
             LIMIT 1),
          (SELECT (p.payoff_date::date - p.payment_due_date::date)
             FROM payments p INNER JOIN contracts c2 ON c2.id = p.contract_id WHERE c2.contract_id = c.contract_id AND p.payoff_date IS NOT NULL AND p.payment_due_date IS NOT NULL ORDER BY p.created_at DESC NULLS LAST LIMIT 1)
        ) AS payoff_date_deviation_days,
        -- Trucking operations count (to drive icon status)
        (SELECT COUNT(*) 
           FROM trucking_operations t
          WHERE t.contract_id = (SELECT id FROM contracts c2 WHERE c2.contract_id = c.contract_id ORDER BY created_at DESC LIMIT 1)
        ) AS trucking_count
      FROM contracts c
      WHERE 1=1
    `;
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (contractIdFilter) {
      queryText += ` AND c.contract_id = $${paramIndex}`;
      queryParams.push(contractIdFilter);
      paramIndex++;
    }

    if (status) {
      // Handle both ACTIVE/CLOSE and Open/Close
      // Priority: Use SAP import status if available, otherwise use contracts table status
      // Open = SAP status = 'Open'/'ACTIVE' OR (no SAP status AND contracts.status = 'ACTIVE')
      // Close = SAP status = 'Close'/'CLOSE'/'COMPLETED'/'CLOSED' OR (no SAP status AND contracts.status IN ('CLOSE', 'COMPLETED', 'CLOSED'))
      if (status === 'Open' || status === 'ACTIVE') {
        queryText += ` AND (
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
        // No parameter to push for this case
      } else if (status === 'Close' || status === 'CLOSE') {
        // For Close, prioritize SAP import status, fallback to contracts table status
        queryText += ` AND (
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
        // No parameter to push for this case
      } else {
        const statusValue = status as string;
        queryText += ` AND (c.status = $${paramIndex} OR EXISTS (
          SELECT 1 FROM sap_processed_data spd 
          WHERE spd.contract_number = c.contract_id 
          AND spd.data->'contract'->>'status' = $${paramIndex}
          ORDER BY spd.created_at DESC LIMIT 1
        ))`;
        queryParams.push(statusValue);
        paramIndex++;
      }
    }

    if (supplier) {
      queryText += ` AND c.supplier ILIKE $${paramIndex}`;
      queryParams.push(`%${supplier}%`);
      paramIndex++;
    }

    if (buyer) {
      queryText += ` AND c.buyer ILIKE $${paramIndex}`;
      queryParams.push(`%${buyer}%`);
      paramIndex++;
    }

    if (dateFrom) {
      queryText += ` AND c.contract_date >= $${paramIndex}`;
      queryParams.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      queryText += ` AND c.contract_date <= $${paramIndex}`;
      queryParams.push(dateTo);
      paramIndex++;
    }

    queryText += ` GROUP BY c.contract_id`;
    
    // Add filters for company_code and b2b_flag after GROUP BY (using HAVING)
    if (companyCode) {
      queryText += ` HAVING EXISTS (
        SELECT 1 FROM sap_processed_data spd 
        WHERE spd.contract_number = c.contract_id 
        AND (
          COALESCE(spd.data->'contract'->>'company_code', '') = $${paramIndex}
          OR COALESCE(spd.data->'raw'->>'Company Code', '') = $${paramIndex}
          OR COALESCE(spd.data->'raw'->>'company code', '') = $${paramIndex}
          OR COALESCE(spd.data->>'Company Code', '') = $${paramIndex}
          OR COALESCE(spd.data->>'company code', '') = $${paramIndex}
        )
        ORDER BY spd.created_at DESC LIMIT 1
      )`;
      queryParams.push(companyCode);
      paramIndex++;
    }
    
    if (b2bFlag) {
      queryText += ` HAVING EXISTS (
        SELECT 1 FROM sap_processed_data spd 
        WHERE spd.contract_number = c.contract_id 
        AND (
          COALESCE(spd.data->'contract'->>'contract_type', '') = $${paramIndex}
          OR COALESCE(spd.data->>'B2B Flag', '') = $${paramIndex}
        )
        ORDER BY spd.created_at DESC LIMIT 1
      )`;
      queryParams.push(b2bFlag);
      paramIndex++;
    }
    
    // Filter for outstanding contracts (after aggregation)
    if (outstanding === 'true') {
      queryText += ` HAVING COALESCE(MAX(c.quantity_ordered) - COALESCE((SELECT SUM(CAST(REPLACE(REPLACE(data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
         FROM sap_processed_data 
         WHERE contract_number = c.contract_id 
         AND sto_number IS NOT NULL 
         AND data->'contract'->>'sto_quantity' IS NOT NULL), 0), MAX(c.quantity_ordered)) > 0`;
    }
    
    queryText += ` ORDER BY MAX(c.created_at) DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(Number(limit), offset);

    const result = await query(queryText, queryParams);

    // Fallback: when SAP doesn't return dp_date/payoff_date but we have deviation days, derive from due_date_payment + deviation
    const due = (d: unknown): Date | null => {
      if (d == null) return null;
      if (d instanceof Date) return d;
      if (typeof d === 'string') return new Date(d);
      return null;
    };
    const addDays = (date: Date, days: number): Date => {
      const out = new Date(date);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };
    for (const row of result.rows) {
      const dueDate = due(row.due_date_payment);
      if (dueDate) {
        if (row.dp_date == null && typeof row.dp_date_deviation_days === 'number') {
          row.dp_date = addDays(dueDate, row.dp_date_deviation_days);
        }
        if (row.payoff_date == null && typeof row.payoff_date_deviation_days === 'number') {
          row.payoff_date = addDays(dueDate, row.payoff_date_deviation_days);
        }
      }
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
      
      if (status) {
        if (status === 'Open' || status === 'ACTIVE') {
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
          // No parameter to push for this case
        } else if (status === 'Close' || status === 'CLOSE') {
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
          // No parameter to push for this case
        } else {
          const statusValue = status as string;
          countQuery += ` AND (c.status = $${countParamIndex} OR EXISTS (
            SELECT 1 FROM sap_processed_data spd 
            WHERE spd.contract_number = c.contract_id 
            AND spd.data->'contract'->>'status' = $${countParamIndex}
            ORDER BY spd.created_at DESC LIMIT 1
          ))`;
          countParams.push(statusValue);
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
      
      if (status) {
        if (status === 'Open' || status === 'ACTIVE') {
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
          // No parameter to push for this case
        } else if (status === 'Close' || status === 'CLOSE') {
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
          // No parameter to push for this case
        } else {
          const statusValue = status as string;
          countQuery += ` AND (c.status = $${countParamIndex} OR EXISTS (
            SELECT 1 FROM sap_processed_data spd 
            WHERE spd.contract_number = c.contract_id 
            AND spd.data->'contract'->>'status' = $${countParamIndex}
            ORDER BY spd.created_at DESC LIMIT 1
          ))`;
          countParams.push(statusValue);
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

