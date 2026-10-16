import { sqlJpsAtaWhileOpen } from './shipmentAtaOverrideSql';
import {
  sqlMaxTruckingLastReceiveDateForContract,
  sqlMaxTruckingWbActualsDateForContract,
  sqlMinTruckingRealizationStartForContract,
} from './truckingSapDates';
import { TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG } from './truckingQuantitySql';

/**
 * The contract's ATC, read the way the Shipments page reads it.
 *
 * Three sources, in the order the Shipments query uses: the KLIP override, the shipment's own
 * column, then the discharge leg. Contract Performance used to read only the middle one, so a
 * contract whose ATC lived on the leg or in an override showed "-" on one page and finished on the
 * other - 8 contracts on the dev copy, one of them with a different date.
 *
 * Purely additive: every row that had an ATC keeps it, and the widening can only fill gaps.
 */
export function sqlLastAtaVesselCompleteDischargeForContract(contractIdExpr: string): string {
  return `(
    SELECT MAX(COALESCE(
      ${sqlJpsAtaWhileOpen('jps_ata_discharge_complete', 'sao_atc', 's_atc')}::date,
      sao_atc.ata_discharge_complete::date,
      s_atc.ata_discharge_complete::date,
      vlp_atc.ata_loading_completed::date
    ))
    FROM shipments s_atc
    LEFT JOIN shipment_ata_overrides sao_atc ON sao_atc.shipment_id = s_atc.id
    LEFT JOIN LATERAL (
      SELECT v_atc.ata_loading_completed
      FROM vessel_loading_ports v_atc
      WHERE v_atc.shipment_id = s_atc.id
        AND COALESCE(v_atc.is_discharge_port, FALSE) = TRUE
        AND v_atc.ata_loading_completed IS NOT NULL
      ORDER BY v_atc.ata_loading_completed DESC
      LIMIT 1
    ) vlp_atc ON TRUE
    WHERE s_atc.contract_id = ${contractIdExpr}
  )`;
}

/**
 * Has EVERY STO of this contract finished discharging?
 *
 * The ATC arm of "effectively done" is guarded by sto_count <= 1, because
 * last_ata_vessel_complete_discharge is a MAX across the contract: on a PO carrying several STOs
 * one discharged STO would otherwise close a PO whose other STO was still loading. PO 1004030633
 * is the worked case - STO 1006019438 discharged while STO 1006019958 still held 402,660 kg.
 *
 * But MAX is the wrong test, not the rule. What the guard protects is "all of them", and a
 * multi-STO contract whose STOs have every one discharged is finished by the same argument that
 * finishes a single-STO one. This is that test, so the guard can stop standing in for it.
 *
 * Two conditions, because either alone can be fooled:
 *   - no STO row of this contract is without a discharge, and
 *   - the STO rows actually checked cover what SAP says the contract has (sto_count). Without
 *     this an STO that SAP knows but KLIP has no contracts row for would pass unexamined.
 *
 * Reuses sqlLastAtaVesselCompleteDischargeForContract rather than restating "has an ATC": the
 * override / own column / discharge leg order is one rule, and a second spelling of it here is
 * exactly how the two pages disagreed before.
 */
export function sqlContractEveryStoDischargedExpr(
  contractNumberExpr: string,
  stoCountExpr: string,
): string {
  return `(
    NOT EXISTS (
      SELECT 1 FROM contracts c_sto_open
      WHERE c_sto_open.contract_id = ${contractNumberExpr}
        AND (${sqlLastAtaVesselCompleteDischargeForContract('c_sto_open.id')}) IS NULL
    )
    AND (
      SELECT COUNT(DISTINCT NULLIF(TRIM(COALESCE(c_sto_cnt.sto_number, '')), ''))
      FROM contracts c_sto_cnt
      WHERE c_sto_cnt.contract_id = ${contractNumberExpr}
    ) >= COALESCE((${stoCountExpr})::numeric, 0)
  )`;
}

/**
 * Has every VESSEL STO of this PO a finished shipment? (Ryan, 2026-10-16: a finished shipment finishes the PO, and any OS left is a
 * shortfall - the rule Shipping Performance already follows.)
 *
 * The sto_count guard above counts every STO SAP lists, trucking (T) STOs included, which never get a vessel ATC: PS23 POs
 * 1014003263/74/79/88 (one vessel STO 1016011410, discharged 2026-10-15, plus 1-3 T STOs each) stayed Open on Contract Performance and
 * Completed on Shipping Performance - 4,000 MT of the 4,843 MT the two pages differed by on production. This looks at vessel STOs only:
 * - a vessel STO is a contract_stos line whose type is not T;
 * - it is finished when a non-cancelled shipment on it has an ATC (override, own column, discharge leg) or status COMPLETED
 *   (1014003256: BG. ELANG JAWA 1 COMPLETED with no ATC recorded);
 * - a B2B origin's vessel STOs and shipments are its children's (origin 9194100035's cargo moved on child 1004031407's STO).
 * One unfinished vessel STO keeps the PO open, so PO 1004030633 (STO 1006019438 discharged, 1006019958 still loading) stays Open. A PO
 * with no vessel STO line returns false and keeps the older rule.
 */
export function sqlContractVesselStosFinishedExpr(contractNumberExpr: string): string {
  const executing = `(
        SELECT ${contractNumberExpr}
        UNION
        SELECT lch.contract_number
        FROM contract_latest_spd_snapshot lch
        WHERE UPPER(TRIM(COALESCE(lch.b2b_flag_raw, ''))) = 'B2B'
          AND NULLIF(TRIM(lch.contract_reference_po_raw), '') IS NOT NULL
          AND TRIM(lch.contract_reference_po_raw) IN (
            SELECT TRIM(cpo.po_number::text) FROM contracts cpo
            WHERE cpo.contract_id = ${contractNumberExpr} AND NULLIF(TRIM(cpo.po_number::text), '') IS NOT NULL
          )
      )`;
  const vesselStos = `
        SELECT TRIM(cvs.sto_number::text) AS sto, cvk.contract_id AS kc
        FROM contract_stos cvs
        INNER JOIN contracts cvk ON cvk.id = cvs.contract_id
        WHERE cvk.contract_id IN ${executing}
          AND NULLIF(TRIM(cvs.sto_number::text), '') IS NOT NULL
          AND UPPER(TRIM(COALESCE(cvs.sto_type, ''))) <> 'T'`;
  return `(
    EXISTS (${vesselStos})
    AND NOT EXISTS (
      SELECT 1 FROM (${vesselStos}) vs
      WHERE NOT EXISTS (
        SELECT 1
        FROM shipments s_vf
        INNER JOIN contracts c_vf ON c_vf.id = s_vf.contract_id
        WHERE c_vf.contract_id = vs.kc
          AND UPPER(TRIM(COALESCE(s_vf.status, ''))) <> 'CANCELLED'
          AND (
            TRIM(COALESCE(s_vf.shipment_id::text, '')) = vs.sto
            OR TRIM(COALESCE(s_vf.shipment_id::text, '')) LIKE vs.sto || '-%'
            OR TRIM(COALESCE(c_vf.sto_number::text, '')) = vs.sto
          )
          AND (
            UPPER(TRIM(COALESCE(s_vf.status, ''))) = 'COMPLETED'
            OR s_vf.ata_discharge_complete IS NOT NULL
            OR EXISTS (SELECT 1 FROM shipment_ata_overrides o_vf WHERE o_vf.shipment_id = s_vf.id AND o_vf.ata_discharge_complete IS NOT NULL)
            OR EXISTS (
              SELECT 1 FROM vessel_loading_ports v_vf
              WHERE v_vf.shipment_id = s_vf.id AND COALESCE(v_vf.is_discharge_port, FALSE) = TRUE AND v_vf.ata_loading_completed IS NOT NULL
            )
          )
      )
    )
  )`;
}

/**
 * Set-based form of sqlContractVesselStosFinishedExpr, for a whole row set at once: `<name>(contract_id, vessel_stos_finished)` for the
 * contracts `scopeSubquery` returns. The per-contract form costs ~3.9 ms a contract (a scan of contract_latest_spd_snapshot for the B2B
 * children each time), 117 s over the 14,806 sea contracts of the dev copy; this one joins once. Same rule, row for row.
 */
export function buildVesselStosFinishedCte(name: string, scopeSubquery: string): string {
  return `
      ${name} AS (
        SELECT links.display_contract_id AS contract_id, BOOL_AND(links.finished) AS vessel_stos_finished
        FROM (
          SELECT l0.display_contract_id, l0.sto, EXISTS (
            SELECT 1
            FROM shipments s_vf
            INNER JOIN contracts c_vf ON c_vf.id = s_vf.contract_id
            WHERE c_vf.contract_id = l0.exec_contract_id
              AND UPPER(TRIM(COALESCE(s_vf.status, ''))) <> 'CANCELLED'
              AND (
                TRIM(COALESCE(s_vf.shipment_id::text, '')) = l0.sto
                OR TRIM(COALESCE(s_vf.shipment_id::text, '')) LIKE l0.sto || '-%'
                OR TRIM(COALESCE(c_vf.sto_number::text, '')) = l0.sto
              )
              AND (
                UPPER(TRIM(COALESCE(s_vf.status, ''))) = 'COMPLETED'
                OR s_vf.ata_discharge_complete IS NOT NULL
                OR EXISTS (SELECT 1 FROM shipment_ata_overrides o_vf WHERE o_vf.shipment_id = s_vf.id AND o_vf.ata_discharge_complete IS NOT NULL)
                OR EXISTS (
                  SELECT 1 FROM vessel_loading_ports v_vf
                  WHERE v_vf.shipment_id = s_vf.id AND COALESCE(v_vf.is_discharge_port, FALSE) = TRUE AND v_vf.ata_loading_completed IS NOT NULL
                )
              )
          ) AS finished
          FROM (
            SELECT DISTINCT cvk.contract_id AS display_contract_id, cvk.contract_id AS exec_contract_id, TRIM(cvs.sto_number::text) AS sto
            FROM contract_stos cvs
            INNER JOIN contracts cvk ON cvk.id = cvs.contract_id
            WHERE cvk.contract_id IN (${scopeSubquery})
              AND NULLIF(TRIM(cvs.sto_number::text), '') IS NOT NULL
              AND UPPER(TRIM(COALESCE(cvs.sto_type, ''))) <> 'T'
            UNION
            SELECT DISTINCT co.contract_id, ch.contract_id, TRIM(cvs.sto_number::text)
            FROM contracts co
            INNER JOIN contract_latest_spd_snapshot lch
              ON UPPER(TRIM(COALESCE(lch.b2b_flag_raw, ''))) = 'B2B'
             AND NULLIF(TRIM(lch.contract_reference_po_raw), '') IS NOT NULL
             AND TRIM(lch.contract_reference_po_raw) = TRIM(co.po_number::text)
            INNER JOIN contracts ch ON ch.contract_id = lch.contract_number AND ch.contract_id <> co.contract_id
            INNER JOIN contract_stos cvs ON cvs.contract_id = ch.id
            WHERE co.contract_id IN (${scopeSubquery})
              AND NULLIF(TRIM(co.po_number::text), '') IS NOT NULL
              AND NULLIF(TRIM(cvs.sto_number::text), '') IS NOT NULL
              AND UPPER(TRIM(COALESCE(cvs.sto_type, ''))) <> 'T'
          ) l0
        ) links
        GROUP BY links.display_contract_id
      )`;
}

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
          ${sqlMaxTruckingLastReceiveDateForContract(contractIdExpr, contractNumberExpr)} AS last_trucking_completion_date,
          ${sqlMaxTruckingWbActualsDateForContract(contractIdExpr)} AS last_trucking_wb_actuals_date,
          (
            SELECT MAX(
              COALESCE(
                tdd.last_daily_deliverable_date::date,
                (
                  SELECT MAX((NULLIF(TRIM(dd.elem->>'date'), ''))::date)
                  FROM jsonb_array_elements(COALESCE(tdd.daily_deliverables, '[]'::jsonb)) AS dd(elem)
                  WHERE NULLIF(TRIM(dd.elem->>'date'), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                )
              )
            )
            FROM trucking_operations tdd
            WHERE tdd.contract_id = ${contractIdExpr}
          ) AS last_trucking_daily_deliverable_date,
          (
            SELECT MAX(COALESCE(t.eta_trucking_completion_date::date, t.eta_delivery_end_date::date))
            FROM trucking_operations t
            WHERE t.contract_id = ${contractIdExpr}
          ) AS open_standard_eta_trucking,
          (SELECT MIN(s2.ata_loading_complete::date) FROM shipments s2 WHERE s2.contract_id = ${contractIdExpr} AND s2.ata_loading_complete IS NOT NULL) AS first_ata_vessel_completed_loading,
          ${sqlLastAtaVesselCompleteDischargeForContract(contractIdExpr)} AS last_ata_vessel_complete_discharge,
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

/**
 * SQL: contract has a cycle Completion Date (same chain as resolveCycleCompletionDate).
 * LAND: Last Receive / WB only when OS ≤ tolerance; else planning / ETA.
 * Expects list-cycle aliases + outstanding_quantity (signed kg from qty_move).
 */
export function sqlHasCycleCompletionDate(
  transportModeExpr: string = 'transport_mode',
  outstandingExpr: string = 'outstanding_quantity',
): string {
  const t = `UPPER(TRIM(COALESCE(${transportModeExpr}, '')))`;
  const osFulfilled = `(
    ${outstandingExpr} IS NOT NULL
    AND (${outstandingExpr})::numeric <= ${TRUCKING_OUTSTANDING_QTY_TOLERANCE_KG}
  )`;
  return `(
    (
      ${t} LIKE 'LAND%'
      AND (
        (
          ${osFulfilled}
          AND (
            last_trucking_completion_date IS NOT NULL
            OR last_trucking_wb_actuals_date IS NOT NULL
          )
        )
        OR last_trucking_daily_deliverable_date IS NOT NULL
        OR open_standard_eta_trucking IS NOT NULL
      )
    )
    OR (
      ${t} LIKE 'SEA%'
      AND (
        last_ata_vessel_complete_discharge IS NOT NULL
        OR open_standard_eta_vessel_loading IS NOT NULL
      )
    )
  )`;
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
