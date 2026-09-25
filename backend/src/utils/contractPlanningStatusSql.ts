import {
  sqlContractEffectivelyDoneExpr,
  sqlContractImportStatusIsCancelledExpr,
  sqlContractImportStatusIsClosedExpr,
} from './contractDeliveryStatus';

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

/**
 * Shipment statuses that mean "scheduled and still under way".
 *
 * COMPLETED and CANCELLED are absent by definition. `shipments` has no UNPLANNED status of its own
 * - the Shipments page synthesises one for contracts with no shipment row at all - so Unplanned is
 * the absence of a row, not a value.
 */
const SHIPMENT_PLANNED_STATUSES = `('PLANNED', 'SAILED', 'ARRIVED_LP')`;

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

/** SQL: this contract has a shipment that is scheduled and not yet finished. */
export function sqlContractHasPlannedShipmentExpr(contractAlias = 'c'): string {
  return `EXISTS (
    SELECT 1 FROM shipments s_pl
    WHERE s_pl.contract_id = ${contractAlias}.id
      AND UPPER(TRIM(COALESCE(s_pl.status, ''))) IN ${SHIPMENT_PLANNED_STATUSES}
  )`;
}

/** SQL: no shipment row at all - the Shipments page's own definition of Unplanned. */
export function sqlContractHasNoShipmentExpr(contractAlias = 'c'): string {
  return `NOT EXISTS (SELECT 1 FROM shipments s_un WHERE s_un.contract_id = ${contractAlias}.id)`;
}

/** SQL: a trucking operation that is under way. Trucking never reports PLANNED - it goes straight
 *  to IN_PROGRESS, which is the state the Trucking page itself labels as planned. */
export function sqlContractHasPlannedTruckingExpr(contractAlias = 'c'): string {
  return `EXISTS (
    SELECT 1 FROM trucking_operations t_pl
    WHERE t_pl.contract_id = ${contractAlias}.id
      AND UPPER(TRIM(COALESCE(t_pl.status, ''))) = 'IN_PROGRESS'
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
  return `(
    EXISTS (
      SELECT 1 FROM trucking_operations t_un
      WHERE t_un.contract_id = ${contractAlias}.id
        AND UPPER(TRIM(COALESCE(t_un.status, ''))) = 'UNPLANNED'
    )
    OR NOT EXISTS (
      SELECT 1 FROM trucking_operations t_any WHERE t_any.contract_id = ${contractAlias}.id
    )
  )`;
}

function sqlIsSeaContract(contractAlias: string, incotermExpr?: string): string {
  const inc = incotermExpr ?? `${contractAlias}.incoterm`;
  return `UPPER(TRIM(COALESCE(${inc}, ''))) IN ${SEA_INCOTERM_LIST}`;
}

/**
 * The contracts Planning Status can meaningfully describe: the ones still running.
 *
 * Without this, "Unplanned" means only "has no shipment row", which a finished contract can easily
 * satisfy - the goods moved, GR closed, and KLIP simply never recorded a shipment. Measured on a
 * copy of production: 1,054 of 15,354 CLOSE contracts were counted Unplanned, which is what made
 * the Close card move when the filter was meant to describe work still ahead.
 *
 * A contract with no GR PO and no GR STO status at all counts as running, not finished. There are
 * 315 of them; 294 are ACTIVE in SAP and 280 have moved nothing, so the absence is SAP not having
 * said yet, rather than evidence of completion. Ryan's decision, 2026-09-25.
 *
 * Built from the page's own Close and Cancelled expressions so the filter and the Open/Close cards
 * cannot disagree about what "finished" means.
 */
export function sqlContractStillRunningExpr(
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
  return `NOT (${closed}) AND NOT (${sqlContractImportStatusIsCancelledExpr(`${alias}.import_status`)})`;
}

export interface PlanningStatusSqlOptions {
  contractAlias?: string;
  /** Override for the incoterm expression when the caller has it under another name. */
  incotermExpr?: string;
  /** Shipping Performance reads shipments only; Contract Performance reads both. */
  includeTrucking?: boolean;
  /**
   * Restrict both buckets to contracts that are still running - see sqlContractStillRunningExpr.
   * Omitted by the contract_scope pushdown, which runs on raw `contracts` where Open/Close is not
   * a column. That leaves the pushdown a superset of this filter, which is exactly what a
   * narrowing pre-filter must be.
   */
  runningGuardSql?: string;
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
  const guard = options.runningGuardSql ? ` AND (${options.runningGuardSql})` : '';

  if (wanted[0] === 'PLANNED') {
    const sea = sqlContractHasPlannedShipmentExpr(alias);
    if (!includeTrucking) return `((${sea})${guard})`;
    return `((
      CASE WHEN ${isSea} THEN ${sea} ELSE ${sqlContractHasPlannedTruckingExpr(alias)} END
    )${guard})`;
  }

  const seaUnplanned = sqlContractHasNoShipmentExpr(alias);
  if (!includeTrucking) return `((${seaUnplanned})${guard})`;
  return `((
    CASE WHEN ${isSea} THEN ${seaUnplanned} ELSE ${sqlContractTruckingUnplannedExpr(alias)} END
  )${guard})`;
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
