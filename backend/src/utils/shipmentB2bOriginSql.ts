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

/**
 * This contract is the B2B origin the execution arm has already counted.
 *
 * The join above remaps a shipment from the B2B child to its origin
 * (`c.id = COALESCE(c_origin.id, c_link.id)`), so shipment_base.contract_numbers - and therefore
 * the execution OS arm, which splits that text per contract - carries the ORIGIN, not the child.
 *
 * The backlog arm cannot see that link with its own guards: no shipment row points at the origin
 * (the child owns it) and the origin carries no STO, so both the shipments.contract_id test and
 * sqlContractSharesNumericStoWithActiveSeaShipmentExpr pass it through. The same outstanding
 * quantity was then added by both arms, breaking the disjointness contractBacklogCoreWhereSql
 * documents ("Exactly once, either way").
 *
 * Measured on the dev copy 2026-09-16: 4 FOB origins, 9,500 MT counted twice, out of the 8,319 MT
 * by which the Shipments FOB OS card exceeded Contract Performance.
 *
 * The origin lookup is an equality on po_number rather than a copy of the remap's
 * `ORDER BY created_at DESC LIMIT 1`: po_number is unique across contracts (verified - zero
 * duplicate groups), so the LIMIT can only ever return that one row and the cheap form is exact.
 * Should po_number ever stop being unique, this has to become the LATERAL the remap uses.
 */
export function sqlContractIsB2bOriginOfShippedChildExpr(contractAlias = 'c'): string {
  return `EXISTS (
          SELECT 1
          FROM latest_spd_contract l_b2b_child
          INNER JOIN contracts c_b2b_child
            ON c_b2b_child.contract_id = l_b2b_child.contract_number
          INNER JOIN shipments s_b2b_child
            ON s_b2b_child.contract_id = c_b2b_child.id
           AND UPPER(TRIM(COALESCE(s_b2b_child.status, ''))) <> 'CANCELLED'
          WHERE NULLIF(TRIM(${contractAlias}.po_number::text), '') IS NOT NULL
            AND UPPER(NULLIF(TRIM(COALESCE(
                  l_b2b_child.b2b_flag_raw,
                  c_b2b_child.contract_type::text,
                  ''
                )), '')) = 'B2B'
            AND NULLIF(TRIM(COALESCE(l_b2b_child.contract_reference_po_raw, '')), '') IS NOT NULL
            AND TRIM(l_b2b_child.contract_reference_po_raw) = TRIM(${contractAlias}.po_number::text)
        )`;
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
