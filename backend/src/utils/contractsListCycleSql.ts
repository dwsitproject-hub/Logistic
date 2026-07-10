import {
  sqlMaxTruckingRealizationEndForContract,
  sqlMinTruckingRealizationStartForContract,
} from './truckingSapDates';

/**
 * Cycle / milestone fields for contracts list.
 * Use inside base CTE (array_agg contract id) or outer page slice (base.id / base.contract_id).
 */
export function buildContractsListCycleFieldSelectSql(
  contractIdExpr: string,
  contractNumberExpr: string,
): string {
  return `
          ${sqlMinTruckingRealizationStartForContract(contractIdExpr, contractNumberExpr)} AS first_trucking_start_date,
          ${sqlMaxTruckingRealizationEndForContract(contractIdExpr, contractNumberExpr)} AS last_trucking_completion_date,
          (
            SELECT MAX((dd->>'date')::date)
            FROM trucking_operations tdd
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(tdd.daily_deliverables, '[]'::jsonb)) AS dd
            WHERE tdd.contract_id = ${contractIdExpr}
              AND (dd->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          ) AS last_trucking_daily_deliverable_date,
          (
            SELECT MAX(COALESCE(t.eta_trucking_completion_date::date, t.eta_delivery_end_date::date))
            FROM trucking_operations t
            WHERE t.contract_id = ${contractIdExpr}
          ) AS open_standard_eta_trucking,
          (SELECT MIN(s2.ata_loading_complete::date) FROM shipments s2 WHERE s2.contract_id = ${contractIdExpr} AND s2.ata_loading_complete IS NOT NULL) AS first_ata_vessel_completed_loading,
          (
            SELECT MAX(
              COALESCE(
                s2.ata_discharge_complete::date,
                s2.arrival_date::date,
                s2.eta_discharge_complete::date
              )
            )
            FROM shipments s2
            WHERE s2.contract_id = ${contractIdExpr}
          ) AS last_ata_vessel_complete_discharge,
          (
            SELECT s2.vessel_name
            FROM shipments s2
            WHERE s2.contract_id = ${contractIdExpr}
              AND NULLIF(TRIM(s2.vessel_name), '') IS NOT NULL
            ORDER BY s2.updated_at DESC NULLS LAST, s2.created_at DESC NULLS LAST
            LIMIT 1
          ) AS last_vessel_name,
          (
            SELECT MAX(
              COALESCE(
                s2.eta_loading_complete::date,
                (
                  SELECT vlpd.eta_loading_completed::date
                  FROM vessel_loading_ports vlpd
                  WHERE vlpd.shipment_id = s2.id
                    AND COALESCE(vlpd.is_discharge_port, false) = false
                  ORDER BY vlpd.updated_at DESC NULLS LAST, vlpd.created_at DESC NULLS LAST
                  LIMIT 1
                )
              )
            )
            FROM shipments s2
            WHERE s2.contract_id = ${contractIdExpr}
          ) AS last_eta_vessel_completed_loading,
          (
            SELECT MAX(
              (
                SELECT vlp.eta_vessel_arrival::date
                FROM vessel_loading_ports vlp
                WHERE vlp.shipment_id = s2.id
                  AND COALESCE(vlp.is_discharge_port, false) = false
                ORDER BY vlp.port_sequence ASC NULLS LAST, vlp.updated_at DESC NULLS LAST, vlp.created_at DESC NULLS LAST
                LIMIT 1
              )
            )
            FROM shipments s2
            WHERE s2.contract_id = ${contractIdExpr}
          ) AS open_standard_eta_vessel_loading,
          (
            SELECT MAX(
              COALESCE(
                s2.eta_discharge_complete::date,
                (
                  SELECT vlpd.eta_vessel_complete_discharge::date
                  FROM vessel_loading_ports vlpd
                  WHERE vlpd.shipment_id = s2.id
                    AND vlpd.is_discharge_port = true
                  ORDER BY vlpd.updated_at DESC NULLS LAST, vlpd.created_at DESC NULLS LAST
                  LIMIT 1
                )
              )
            )
            FROM shipments s2
            WHERE s2.contract_id = ${contractIdExpr}
          ) AS last_eta_vessel_complete_discharge`;
}

/** Base CTE inside GROUP BY — uses aggregated contract id expressions. */
export function buildContractsListBaseCycleFieldSelectSql(): string {
  return buildContractsListCycleFieldSelectSql(
    '(array_agg(c.id ORDER BY c.created_at DESC))[1]',
    '(array_agg(c.contract_id ORDER BY c.created_at DESC))[1]',
  );
}

/** Page slice only — cycle fields computed for returned rows (not full YTD scope). */
export function buildContractsListOuterCycleFieldSelectSql(): string {
  return buildContractsListCycleFieldSelectSql('base.id', 'base.contract_id');
}
