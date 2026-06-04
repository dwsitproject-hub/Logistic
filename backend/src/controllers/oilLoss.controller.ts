import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';

export const getOilLoss = async (_req: AuthRequest, res: Response) => {
  try {
    const sql = `
      WITH parsed AS (
        SELECT
          spd.id,
          COALESCE(spd.data->'raw'->>'SEA / LAND', 'LAND')          AS transport_mode,
          COALESCE(spd.data->'raw'->>'Contract Ext No',
                   spd.data->'raw'->>'Contract No', '')              AS operation_id,
          COALESCE(spd.data->'raw'->>'Contract No', '')              AS contract_number,
          COALESCE(spd.data->'raw'->>'Contract Ext No', '')          AS contract_ext_no,
          COALESCE(spd.data->'raw'->>'STO No', '')                   AS sto_number,
          COALESCE(spd.data->'raw'->>'PO No', '')                    AS po_number,
          COALESCE(spd.data->'raw'->>'Supplier', '')                 AS supplier,
          COALESCE(spd.data->'raw'->>'Buyer', '')                    AS buyer,
          COALESCE(spd.data->'raw'->>'Product', '')                  AS product,
          COALESCE(spd.data->'raw'->>'Vendor Group', '')             AS group_name,
          CASE
            WHEN COALESCE(spd.data->'raw'->>'SEA / LAND', 'LAND') = 'SEA'
            THEN COALESCE(spd.data->'raw'->>'Vessel Discharge Port', '')
            ELSE COALESCE(spd.data->'raw'->>'Truck Discharge Location', '')
          END                                                         AS plant_site,
          CASE
            WHEN spd.data->'raw'->>'Contract Date' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$'
            THEN TO_CHAR(TO_DATE(spd.data->'raw'->>'Contract Date', 'MM/DD/YY'), 'YYYY-MM-DD')
            WHEN spd.data->'raw'->>'Contract Date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            THEN spd.data->'raw'->>'Contract Date'
            ELSE NULL
          END                                                         AS operation_date,
          COALESCE(spd.data->'raw'->>'Status', '')                   AS status,
          REPLACE(REPLACE(
            COALESCE(spd.data->'raw'->>'Quantity Delivery', '0'), ',', ''), ' ', '')::numeric AS qty_delivery,
          REPLACE(REPLACE(
            COALESCE(spd.data->'raw'->>'Quantity Receive',  '0'), ',', ''), ' ', '')::numeric AS qty_receive
        FROM sap_processed_data spd
        WHERE spd.data->'raw'->>'Quantity Receive'  IS NOT NULL
          AND spd.data->'raw'->>'Quantity Delivery' IS NOT NULL
          AND REPLACE(REPLACE(spd.data->'raw'->>'Quantity Receive',  ',', ''), ' ', '') ~ '^[0-9.]+$'
          AND REPLACE(REPLACE(spd.data->'raw'->>'Quantity Delivery', ',', ''), ' ', '') ~ '^[0-9.]+$'
      )
      SELECT
        id,
        transport_mode,
        operation_id,
        contract_number,
        contract_ext_no,
        sto_number,
        po_number,
        supplier,
        buyer,
        product,
        group_name,
        plant_site,
        operation_date,
        status,
        qty_delivery                                AS quantity_sent,
        qty_receive                                 AS quantity_received,
        (qty_receive - qty_delivery)                AS gain_loss_amount,
        CASE
          WHEN qty_delivery > 0
          THEN ROUND((qty_receive - qty_delivery) / qty_delivery * 100, 4)
          ELSE 0
        END                                         AS gain_loss_percentage
      FROM parsed
      WHERE qty_receive < qty_delivery
        AND LOWER(status) = 'close'
      ORDER BY (qty_receive - qty_delivery) ASC
    `;

    const gainSql = `
      WITH parsed AS (
        SELECT
          REPLACE(REPLACE(
            COALESCE(spd.data->'raw'->>'Quantity Delivery', '0'), ',', ''), ' ', '')::numeric AS qty_delivery,
          REPLACE(REPLACE(
            COALESCE(spd.data->'raw'->>'Quantity Receive',  '0'), ',', ''), ' ', '')::numeric AS qty_receive,
          COALESCE(spd.data->'raw'->>'Status', '') AS status
        FROM sap_processed_data spd
        WHERE spd.data->'raw'->>'Quantity Receive'  IS NOT NULL
          AND spd.data->'raw'->>'Quantity Delivery' IS NOT NULL
          AND REPLACE(REPLACE(spd.data->'raw'->>'Quantity Receive',  ',', ''), ' ', '') ~ '^[0-9.]+$'
          AND REPLACE(REPLACE(spd.data->'raw'->>'Quantity Delivery', ',', ''), ' ', '') ~ '^[0-9.]+$'
      )
      SELECT
        COALESCE(SUM(qty_receive - qty_delivery), 0) AS total_gain_kg,
        COUNT(*)::int                                 AS gain_count
      FROM parsed
      WHERE qty_receive > qty_delivery
        AND LOWER(status) = 'close'
    `;

    const [result, gainResult] = await Promise.all([query(sql), query(gainSql)]);
    const gainRow = gainResult.rows[0] ?? { total_gain_kg: 0, gain_count: 0 };
    return res.json({
      data: result.rows,
      gainSummary: {
        totalGainKg: Number(gainRow.total_gain_kg),
        gainCount:   Number(gainRow.gain_count),
      },
    });
  } catch (err) {
    console.error('Oil loss fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch oil loss data' });
  }
};
