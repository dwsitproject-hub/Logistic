import {
  sqlContractEffectivelyDoneExpr,
  sqlContractImportStatusIsCancelledExpr,
  sqlContractImportStatusIsClosedExpr,
} from './contractDeliveryStatus';
import { sqlTruckingOpIsActiveForMatchingSql } from './truckingOperationUniqueness';

/**
 * Planning Status: has this contract's cargo been scheduled, and is that schedule still live?
 *
 * Two values, as Ryan defined them on 2026-09-24:
 *
 *   Unplanned  nothing scheduled yet
 *   Planned    scheduled and still running - up to but NOT including completed, and never cancelled
 *
 * A contract that has finished is in neither bucket. That is deliberate: the filter answers "what
 * still needs watching", and a completed contract does not. Measured on a copy of production,
 * 1,650 contracts are Planned and 1,848 Unplanned; the remaining ~15,400 are done and drop out of
 * both.
 *
 * WHICH SOURCE ANSWERS depends on how the cargo moves, and that is decided by the incoterm rather
 * than by `transport_mode` - Ryan's rule, and the reason MIX needs no special case here. Sea
 * contracts are planned as shipments, land contracts as trucking operations.
 *
 * Shipping Performance reads shipments only; Contract Performance reads both, because scoping it
 * to shipments alone would call 16,121 LAND contracts Unplanned while their trucks were running.
 */

/** Incoterms whose cargo moves by vessel, matching SHIPMENT_PAGE_SEA_INCOTERMS plus CNF. */
const SEA_INCOTERM_LIST = `('CIF', 'FOB', 'CFR', 'CNF')`;

export type ContractPlanningStatus = 'PLANNED' | 'UNPLANNED';

export function normalizePlanningStatusValues(values: unknown): ContractPlanningStatus[] {
  const raw = Array.isArray(values) ? values : [values];
  const out = new Set<ContractPlanningStatus>();
  for (const v of raw) {
    const s = String(v ?? '').trim().toUpperCase();
    if (s === 'PLANNED' || s === 'UNPLANNED') out.add(s);
  }
  return [...out];
}

/** Every ETA a shipment or its ports can carry - the same list the Shipments page checks. */
const SHIPMENT_ETA_FIELDS = `(
        s_pl.eta_arrival IS NOT NULL
        OR s_pl.eta_berthed IS NOT NULL
        OR s_pl.eta_loading_start IS NOT NULL
        OR s_pl.eta_loading_complete IS NOT NULL
        OR s_pl.eta_sailed IS NOT NULL
        OR s_pl.eta_discharge_arrival IS NOT NULL
        OR s_pl.eta_discharge_berthed IS NOT NULL
        OR s_pl.eta_discharge_start IS NOT NULL
        OR s_pl.eta_discharge_complete IS NOT NULL
        OR vlp_pl.eta_vessel_arrival IS NOT NULL
        OR vlp_pl.eta_vessel_berthed IS NOT NULL
        OR vlp_pl.eta_loading_start IS NOT NULL
        OR vlp_pl.eta_loading_completed IS NOT NULL
        OR vlp_pl.eta_vessel_sailed IS NOT NULL
        OR vlp_pl.eta_vessel_complete_discharge IS NOT NULL
      )`;

/**
 * SEA: planned means a shipment that is STILL RUNNING carries a registered ETA.
 *
 * Deliberately one step stricter than the Shipments page's Unplanned card, which counts any
 * registered ETA including a completed shipment's. Ryan's rule: a completed shipment is not a plan
 * for the quantity still outstanding. Without the exclusion, a contract whose shipments had all
 * finished read as Planned forever - 2,980 of 3,494 running contracts, which made the filter say
 * almost nothing.
 *
 * A cancelled shipment's ETA is not a plan either, for the same reason the Shipments page excludes
 * it: the voyage is not going to happen.
 */
export function sqlContractHasPlannedShipmentExpr(contractAlias = 'c'): string {
  return `EXISTS (
    SELECT 1
    FROM shipments s_pl
    LEFT JOIN vessel_loading_ports vlp_pl ON vlp_pl.shipment_id = s_pl.id
    WHERE s_pl.contract_id = ${contractAlias}.id
      AND UPPER(TRIM(COALESCE(s_pl.status, ''))) NOT IN ('CANCELLED', 'COMPLETED')
      AND ${SHIPMENT_ETA_FIELDS}
  )`;
}

/**
 * SEA unplanned, as the Shipments page defines it: no shipment-level or port-level ETA registered,
 * with a cancelled shipment's ETA not counting as a plan.
 *
 * This used to read "no shipment row at all", which is a different and much narrower question. A
 * contract whose shipments had all completed while outstanding quantity remained had a row, so it
 * was not Unplanned - and no live shipment, so it was not Planned either. 1,128 running contracts
 * sat in neither bucket, 781 of them carrying 11,107 MT with nothing scheduled to move it. Those
 * are exactly the ones the filter exists to surface.
 */
export function sqlContractHasNoShipmentExpr(contractAlias = 'c'): string {
  return `NOT (${sqlContractHasPlannedShipmentExpr(contractAlias)})`;
}

/** SQL: a trucking operation that is under way. Trucking never reports PLANNED - it goes straight
 *  to IN_PROGRESS, which is the state the Trucking page itself labels as planned. */
/**
 * LAND: planned means an operation that is still running - active for matching, and not completed.
 * Same reasoning as the sea side; a finished haul does not plan what is still outstanding.
 */
export function sqlContractHasPlannedTruckingExpr(contractAlias = 'c'): string {
  return `EXISTS (
    SELECT 1 FROM trucking_operations t_pl
    WHERE t_pl.contract_id = ${contractAlias}.id
      AND ${sqlTruckingOpIsActiveForMatchingSql('t_pl')}
      AND UPPER(TRIM(COALESCE(t_pl.status, ''))) <> 'COMPLETED'
  )`;
}

/**
 * SQL: trucking is not scheduled.
 *
 * Two shapes count, and they are the same answer: an operation that says UNPLANNED (622 contracts)
 * and no operation at all (251). Treating only the first as Unplanned would leave those 251 in
 * neither bucket, while the sea side already reads "no shipment row" as Unplanned.
 */
export function sqlContractTruckingUnplannedExpr(contractAlias = 'c'): string {
  return `NOT (${sqlContractHasPlannedTruckingExpr(contractAlias)})`;
}

function sqlIsSeaContract(contractAlias: string, incotermExpr?: string): string {
  const inc = incotermExpr ?? `${contractAlias}.incoterm`;
  return `UPPER(TRIM(COALESCE(${inc}, ''))) IN ${SEA_INCOTERM_LIST}`;
}

/**
 * Contracts Planning Status cannot describe: the ones already finished.
 *
 * Planned and Unplanned describe work still ahead, so a finished contract is outside the question
 * rather than an answer to it. Rows matching this expression PASS the filter untouched, which is
 * what keeps the Close card still while the Open card narrows - Ryan's requirement, and the
 * behaviour the numbers argue for too: "Unplanned" used to include 1,054 of 15,354 CLOSE contracts,
 * measured on a copy of production, purely because they had no shipment row. The goods had moved
 * and GR had closed; KLIP had simply never recorded a shipment.
 *
 * A contract with no GR PO and no GR STO status at all is NOT finished. There are 315; 294 are
 * ACTIVE in SAP and 280 have moved nothing, so the blank is SAP not having said yet rather than
 * evidence of completion - Ryan's decision, 2026-09-25.
 *
 * Built from the page's own Close and Cancelled expressions, so the filter and the Open/Close cards
 * cannot disagree about which contracts are finished.
 */
export function sqlContractFinishedExpr(
  options: { alias?: string; effectivelyDone?: boolean } = {},
): string {
  const alias = options.alias ?? 'base';
  const closed = sqlContractImportStatusIsClosedExpr(
    `${alias}.import_status`,
    `${alias}.import_status IS NULL AND UPPER(${alias}.status) IN ('CLOSE', 'COMPLETED', 'CLOSED')`,
    options.effectivelyDone
      ? sqlContractEffectivelyDoneExpr({
          outstandingKgExpr: `${alias}.outstanding_quantity`,
          atcExpr: `${alias}.last_ata_vessel_complete_discharge`,
          stoCountExpr: `${alias}.sto_count`,
        })
      : undefined,
  );
  return `(${closed}) OR (${sqlContractImportStatusIsCancelledExpr(`${alias}.import_status`)})`;
}

export interface PlanningStatusSqlOptions {
  contractAlias?: string;
  /** Override for the incoterm expression when the caller has it under another name. */
  incotermExpr?: string;
  /** Shipping Performance reads shipments only; Contract Performance reads both. */
  includeTrucking?: boolean;
  /**
   * Contracts this filter does not apply to - see sqlContractFinishedExpr. They pass through
   * rather than being excluded, so the Close card keeps its full value while the Open card narrows.
   */
  finishedExprSql?: string;
}

/**
 * A WHERE fragment for the selected Planning Status values, or null when nothing is selected or
 * both are - in which case the caller should not filter at all rather than build `(A OR B)`, which
 * would silently drop every completed contract.
 */
export function sqlContractPlanningStatusFilter(
  statuses: ContractPlanningStatus[],
  options: PlanningStatusSqlOptions = {},
): string | null {
  const wanted = normalizePlanningStatusValues(statuses);
  if (wanted.length === 0 || wanted.length === 2) return null;

  const alias = options.contractAlias ?? 'c';
  const includeTrucking = options.includeTrucking !== false;
  const isSea = sqlIsSeaContract(alias, options.incotermExpr);
  const passThrough = options.finishedExprSql ? `(${options.finishedExprSql}) OR ` : '';

  if (wanted[0] === 'PLANNED') {
    const sea = sqlContractHasPlannedShipmentExpr(alias);
    if (!includeTrucking) return `(${passThrough}(${sea}))`;
    return `(${passThrough}(
      CASE WHEN ${isSea} THEN ${sea} ELSE ${sqlContractHasPlannedTruckingExpr(alias)} END
    ))`;
  }

  const seaUnplanned = sqlContractHasNoShipmentExpr(alias);
  if (!includeTrucking) return `(${passThrough}(${seaUnplanned}))`;
  return `(${passThrough}(
    CASE WHEN ${isSea} THEN ${seaUnplanned} ELSE ${sqlContractTruckingUnplannedExpr(alias)} END
  ))`;
}

/**
 * The status shown in the Contract Performance table's Shipment Status / Trucking Status columns.
 *
 * A PO can carry several STOs, and Ryan's rule is that the live one represents the contract: one
 * STO Planned and another Completed reads Planned, because that is the half still needing
 * attention - the per-STO detail is on the contract detail modal. CANCELLED is ignored entirely
 * unless it is all there is; 35 of the 47 contracts with mixed shipment statuses are
 * CANCELLED + COMPLETED, and calling those Cancelled would hide finished work.
 */
export function sqlRepresentativeShipmentStatusExpr(contractAlias = 'c'): string {
  return `(
    SELECT s_rep.status
    FROM shipments s_rep
    WHERE s_rep.contract_id = ${contractAlias}.id
    ORDER BY CASE UPPER(TRIM(COALESCE(s_rep.status, '')))
               WHEN 'PLANNED' THEN 0
               WHEN 'ARRIVED_LP' THEN 1
               WHEN 'SAILED' THEN 2
               WHEN 'COMPLETED' THEN 3
               WHEN 'CANCELLED' THEN 5
               ELSE 4
             END,
             s_rep.updated_at DESC NULLS LAST
    LIMIT 1
  )`;
}

export function sqlRepresentativeTruckingStatusExpr(contractAlias = 'c'): string {
  return `(
    SELECT t_rep.status
    FROM trucking_operations t_rep
    WHERE t_rep.contract_id = ${contractAlias}.id
    ORDER BY CASE UPPER(TRIM(COALESCE(t_rep.status, '')))
               WHEN 'UNPLANNED' THEN 0
               WHEN 'IN_PROGRESS' THEN 1
               WHEN 'COMPLETED' THEN 3
               WHEN 'CANCELLED' THEN 5
               ELSE 4
             END,
             t_rep.updated_at DESC NULLS LAST
    LIMIT 1
  )`;
}
