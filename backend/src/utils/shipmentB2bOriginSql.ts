/**
 * B2B child sea shipments are stored on the child contract, but the Shipments
 * view table hides children (Reff PO set). Remap those rows to the origin
 * contract (Reff PO → origin.po_number) so the Type V / vessel leg appears on
 * the origin PO — same overlay idea as Contracts/Trucking, without showing the
 * child as its own row.
 */

import { SQL_SPD_CONTRACT_REFF_PO } from './b2bOriginEndingSql';

/**
 * List-grain joins: shipment → execution contract (`c_link`) → display contract
 * (`c` = origin when the execution contract is a B2B child).
 * Requires CTE `latest_spd_contract` with both child and origin contract_numbers.
 */
export function sqlShipmentListB2bOriginContractJoins(): string {
  return `
        LEFT JOIN contracts c_link ON s.contract_id = c_link.id
        LEFT JOIN latest_spd_contract l_link ON l_link.contract_number = c_link.contract_id
        LEFT JOIN LATERAL (
          SELECT o.id
          FROM contracts o
          WHERE UPPER(NULLIF(TRIM(COALESCE(l_link.b2b_flag_raw, c_link.contract_type::text, '')), '')) = 'B2B'
            AND NULLIF(TRIM(COALESCE(l_link.contract_reference_po_raw, '')), '') IS NOT NULL
            AND TRIM(o.po_number::text) = TRIM(l_link.contract_reference_po_raw)
          ORDER BY o.created_at DESC NULLS LAST
          LIMIT 1
        ) c_origin ON true
        LEFT JOIN contracts c ON c.id = COALESCE(c_origin.id, c_link.id)
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id`;
}

/** STO Type V/T line on the execution contract (child), not the remapped origin. */
export function sqlShipmentListExecutionCsStoJoin(stoKeyExpr: string): string {
  return `LEFT JOIN contract_stos cs_sto ON cs_sto.contract_id = c_link.id
          AND NULLIF(TRIM(cs_sto.sto_number::text), '') IS NOT NULL
          AND TRIM(cs_sto.sto_number::text) = TRIM((${stoKeyExpr})::text)`;
}

/**
 * relevant_contract_numbers plus origin contract_ids of shipped B2B children,
 * so `latest_spd_contract` can resolve origin GR / B2B flag after remap.
 */
export function sqlRelevantContractNumbersWithB2bOrigins(shipmentContractsWhereSql: string): string {
  return `
      relevant_shipment_contracts AS (
        SELECT DISTINCT c.contract_id
        FROM shipments s
        INNER JOIN contracts c ON s.contract_id = c.id
        WHERE ${shipmentContractsWhereSql}
      ),
      relevant_contract_numbers AS (
        SELECT contract_id FROM relevant_shipment_contracts
        UNION
        SELECT DISTINCT o.contract_id
        FROM relevant_shipment_contracts rc
        INNER JOIN LATERAL (
          SELECT ${SQL_SPD_CONTRACT_REFF_PO('spd.data')} AS reff
          FROM sap_processed_data spd
          WHERE spd.contract_number = rc.contract_id
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1
        ) ch_reff ON ch_reff.reff IS NOT NULL
        INNER JOIN contracts o ON TRIM(o.po_number::text) = ch_reff.reff
      )`;
}
