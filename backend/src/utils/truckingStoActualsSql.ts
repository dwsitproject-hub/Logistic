/**
 * Per-STO SAP trucking dates + delivery/receive qty for modal Section 4.
 */

import { SPD_EFFECTIVE_STO_SQL } from './contractLogisticsStoDetailSql';
import {
  sqlSapTruckingLastReceiveDateForStoKey,
  sqlSapTruckingStartReceiveDateForStoKey,
} from './truckingSapDates';
import {
  SAP_DELIVERY_RAW_FIELDS,
  SAP_RECEIVE_RAW_FIELDS,
  sqlCoalesceSapRawQtyFields,
  sqlNormalizeSapTruckingQtyToKg,
} from './truckingQuantitySql';

const SPD_EFFECTIVE_STO = SPD_EFFECTIVE_STO_SQL;

function sqlStoSapQtySum(
  contractNumberExpr: string,
  stoKeyExpr: string,
  fields: readonly string[],
): string {
  const rawCast = `CAST(REPLACE(REPLACE(TRIM(q.val), ',', ''), ' ', '') AS NUMERIC)`;
  const coalesced = sqlCoalesceSapRawQtyFields(fields);
  return `COALESCE((
    SELECT SUM(${sqlNormalizeSapTruckingQtyToKg(rawCast, 'COALESCE(c.quantity_ordered, 0)')})
    FROM (
      SELECT ${coalesced} AS val
      FROM sap_processed_data spd
      WHERE TRIM(spd.contract_number) = TRIM(${contractNumberExpr}::text)
        AND ${SPD_EFFECTIVE_STO} = TRIM(${stoKeyExpr}::text)
        AND NULLIF(TRIM(COALESCE(${coalesced})), '') IS NOT NULL
    ) q
    WHERE q.val IS NOT NULL AND trim(q.val) ~ '^[0-9.,\\s]+$'
  ), 0)::numeric`;
}

/**
 * SQL that returns one row per STO for a contract uuid ($1) with SAP dates + qty (kg).
 * Caller binds: $1 = contracts.id
 */
export function sqlTruckingStoActualsByContractId(): string {
  return `
    WITH sto_keys AS (
      SELECT DISTINCT TRIM(x.sto_line) AS sto_number
      FROM (
        SELECT TRIM(cs.sto_number::text) AS sto_line
        FROM contract_stos cs
        WHERE cs.contract_id = $1
          AND cs.sto_number IS NOT NULL AND TRIM(cs.sto_number::text) != ''
        UNION
        SELECT TRIM(${SPD_EFFECTIVE_STO}) AS sto_line
        FROM sap_processed_data spd
        INNER JOIN contracts c ON c.contract_id = spd.contract_number
        WHERE c.id = $1
          AND ${SPD_EFFECTIVE_STO} IS NOT NULL
      ) x
      WHERE NULLIF(TRIM(x.sto_line), '') IS NOT NULL
    )
    SELECT
      sk.sto_number,
      ${sqlSapTruckingStartReceiveDateForStoKey('c.contract_id', 'sk.sto_number')}::text
        AS sap_trucking_start_receive_date,
      ${sqlSapTruckingLastReceiveDateForStoKey('c.contract_id', 'sk.sto_number')}::text
        AS sap_trucking_last_receive_date,
      ${sqlStoSapQtySum('c.contract_id', 'sk.sto_number', SAP_DELIVERY_RAW_FIELDS)} AS sap_qty_delivery,
      ${sqlStoSapQtySum('c.contract_id', 'sk.sto_number', SAP_RECEIVE_RAW_FIELDS)} AS sap_qty_receive
    FROM sto_keys sk
    CROSS JOIN contracts c
    WHERE c.id = $1
    ORDER BY sk.sto_number
  `;
}
