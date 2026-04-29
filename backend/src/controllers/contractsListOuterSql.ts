/**
 * Outer projection for GET /contracts list rows.
 * `base` must be the page slice (e.g. FROM page AS base) so payment/doc subqueries run only for returned rows.
 */
export const CONTRACTS_LIST_OUTER_SQL = `
      SELECT
        base.contract_id,
        base.id,
        base.buyer,
        COALESCE(NULLIF(TRIM(base.company_name), ''), COALESCE(base.latest_spd_data->'raw'->>'Buyer', base.latest_spd_data->>'Buyer')) AS company_name,
        base.supplier,
        base.group_name,
        base.product,
        base.quantity_ordered,
        base.quantity_delivery,
        base.quantity_receive,
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
        base.cargo_readiness_date,
        COALESCE(
          NULLIF((
            SELECT s.port_of_discharge
            FROM shipments s
            WHERE s.contract_id = base.id
              AND s.port_of_discharge IS NOT NULL
              AND TRIM(s.port_of_discharge) <> ''
            ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
            LIMIT 1
          ), ''),
          NULLIF((
            SELECT t.location
            FROM trucking_operations t
            WHERE t.contract_id = base.id
              AND t.location IS NOT NULL
              AND TRIM(t.location) <> ''
            ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST
            LIMIT 1
          ), '')
        ) AS plant_site,
        base.created_at,
        base.po_numbers,
        base.sto_number,
        base.sto_numbers_agg AS sto_numbers,
        base.total_sto_quantity,
        (
          base.quantity_ordered
          - COALESCE(
              CASE
                WHEN UPPER(TRIM(COALESCE(base.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN base.quantity_receive
                WHEN UPPER(TRIM(COALESCE(base.incoterm, ''))) IN ('LCO', 'FOB') THEN base.quantity_delivery
                ELSE base.total_sto_quantity
              END,
              0
            )
        )::numeric AS outstanding_quantity,
        base.po_count,
        base.sto_count,
        COALESCE(base.latest_spd_data->'contract'->>'company_code', base.latest_spd_data->'raw'->>'Company Code', base.latest_spd_data->'raw'->>'company code', base.latest_spd_data->>'Company Code', base.latest_spd_data->>'company code') AS company_code,
        COALESCE(base.latest_spd_data->'contract'->>'contract_type', base.latest_spd_data->>'B2B Flag') AS b2b_flag,
        COALESCE(
          base.latest_spd_data->'contract'->>'contract_reference_po',
          base.latest_spd_data->>'CONTRACT REFF PO',
          base.latest_spd_data->>'Contract Reff PO Ini',
          base.latest_spd_data->'raw'->>'Contract Reff PO Ini',
          base.latest_spd_data->'raw'->>'CONTRACT REFF PO'
        ) AS contract_reference_po,
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
        (SELECT COUNT(*) FROM documents d WHERE d.contract_id = base.id) AS document_count,
        base.first_trucking_start_date,
        base.last_trucking_completion_date,
        base.last_trucking_daily_deliverable_date,
        base.first_ata_vessel_completed_loading,
        base.last_ata_vessel_complete_discharge,
        base.last_eta_vessel_complete_discharge
      FROM page AS base
      ORDER BY base.contract_date DESC NULLS LAST, base.contract_id DESC
`;
