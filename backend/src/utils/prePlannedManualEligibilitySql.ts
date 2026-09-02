/**
 * Re-validation SQL for MANUAL Preplanned grouping (Shipments View Table "Select"
 * column). Unlike the AUTO-clustering eligibility pool (prePlannedEligibilitySql.ts,
 * which layers on partition/date/transport-mode tuning rules for the rebuild job),
 * this checks the exact same "is this still a legitimate open Unplanned backlog row"
 * rules the Shipments page Unplanned card itself uses (contractBacklogCoreWhereSql),
 * so a contract visible as Unplanned in the table is never wrongly rejected here.
 */

import { groupPlantExpr } from './groupPlantSql';
import { buildQtyMoveCte, sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';
import {
  buildUnplannedContractBacklogLatestSpdCte,
  contractBacklogCoreWhereSql,
} from './shipmentUnplannedHybridSql';
import { contractInAcceptedUnlinkedPrePlannedGroupExistsSql } from './prePlannedEligibilitySql';

export function buildManualPrePlannedEligibleContractsByIdsQuery(contractIds: string[]): {
  sql: string;
  params: unknown[];
} {
  const plantExpr = groupPlantExpr('c.plant_code', 'c.company_name');
  const incotermExpr = contractEffectiveIncotermExpr('c');
  const outstandingKgExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr,
    contractNumberExpr: 'c.contract_id',
  });

  const sql = `
    WITH ${buildQtyMoveCte({ kind: 'in_subquery', subquery: 'SELECT contract_id FROM contracts c2' })},
    ${buildUnplannedContractBacklogLatestSpdCte()}
    SELECT
      c.id,
      c.contract_id,
      c.buyer,
      c.supplier,
      c.product,
      c.incoterm,
      c.group_name,
      c.contract_date,
      c.delivery_start_date,
      c.delivery_end_date,
      c.plant_code,
      c.company_name,
      c.transport_mode,
      c.status,
      ${plantExpr} AS group_plant,
      (${outstandingKgExpr}) / 1000.0 AS os_mt,
      c.quantity_ordered / 1000.0 AS contract_qty_mt
    FROM contracts c
    LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
    WHERE c.id = ANY($1::uuid[])
      AND ${contractBacklogCoreWhereSql('c', 'l')}
      AND NOT ${contractInAcceptedUnlinkedPrePlannedGroupExistsSql('c')}
  `;

  return { sql, params: [contractIds] };
}
