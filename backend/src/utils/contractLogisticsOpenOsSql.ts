/**
 * Open-contract OS that belongs on logistics strips (Shipments + Trucking).
 *
 * CP Open outstanding should match:
 *   Shipments OS (FOB/CIF/CFR, Unplanned–At DP, contract grain)
 * + Trucking OS (FRC/LCO, Unplanned+Planned+In Progress)
 *
 * SAP Open but pipeline Completed/Cancelled is excluded (population gap).
 */

import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import { sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { SHIPMENT_PAGE_SEA_INCOTERMS } from './shipmentIncotermScope';
import { BACKLOG_OS_COMPLETED_MAX_KG } from './shipmentUnplannedHybridSql';
import { TRUCKING_PAGE_INCOTERMS } from './truckingIncotermScope';
import { sqlTruckingOpIsActiveForMatchingSql } from './truckingOperationUniqueness';
import { sqlTruckingPipelineIsCompletedExpr } from './truckingQuantitySql';

const SEA_LIST = SHIPMENT_PAGE_SEA_INCOTERMS.map((c) => `'${c}'`).join(', ');
const LAND_LIST = TRUCKING_PAGE_INCOTERMS.map((c) => `'${c}'`).join(', ');

export function sqlIncotermIsSeaLogistics(incotermExpr: string): string {
  return `UPPER(TRIM(COALESCE(${incotermExpr}, ''))) IN (${SEA_LIST})`;
}

export function sqlIncotermIsLandLogistics(incotermExpr: string): string {
  return `UPPER(TRIM(COALESCE(${incotermExpr}, ''))) IN (${LAND_LIST})`;
}

function sqlContractQtyMoveOsKg(contractNumberExpr: string, incotermExpr: string): string {
  return sqlContractGlobalOutstandingExpr({
    contractQtyExpr: `(SELECT c2.quantity_ordered FROM contracts c2 WHERE c2.contract_id = ${contractNumberExpr} LIMIT 1)`,
    incotermExpr,
    contractNumberExpr,
  });
}

/** Non-cancelled shipment that is still on the active OS pipeline (not Completed). */
function sqlHasActiveSeaShipment(contractUuidExpr: string): string {
  return `EXISTS (
    SELECT 1
    FROM shipments s
    INNER JOIN contracts sc ON sc.id = s.contract_id
    WHERE s.contract_id = ${contractUuidExpr}
      AND UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('CANCELLED', 'CANCELED')
      AND NOT (${sqlIsContractSapClosedExpr('sc')})
      AND s.ata_discharge_complete IS NULL
  )`;
}

function sqlHasNonCancelledSeaShipment(contractUuidExpr: string): string {
  return `EXISTS (
    SELECT 1
    FROM shipments s
    WHERE s.contract_id = ${contractUuidExpr}
      AND UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('CANCELLED', 'CANCELED')
  )`;
}

/** Trucking op still on Unplanned / Planned / In Progress (not pipeline Completed). */
function sqlHasActiveLandTrucking(contractUuidExpr: string): string {
  const outstanding = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: 'tc.quantity_ordered',
    incotermExpr: 'tc.incoterm',
    contractNumberExpr: 'tc.contract_id',
  });
  return `EXISTS (
    SELECT 1
    FROM trucking_operations t
    INNER JOIN contracts tc ON tc.id = t.contract_id
    WHERE t.contract_id = ${contractUuidExpr}
      AND ${sqlTruckingOpIsActiveForMatchingSql('t')}
      AND NOT (${sqlTruckingPipelineIsCompletedExpr('tc', outstanding)})
      AND UPPER(TRIM(COALESCE(t.status, ''))) NOT IN ('COMPLETED', 'COMPLETE')
  )`;
}

function sqlHasActiveLandTruckingOp(contractUuidExpr: string): string {
  return `EXISTS (
    SELECT 1
    FROM trucking_operations t
    WHERE t.contract_id = ${contractUuidExpr}
      AND ${sqlTruckingOpIsActiveForMatchingSql('t')}
  )`;
}

/**
 * True when this Open contract's outstanding qty should sit on CP Open
 * (same universe as Shipments strip + Trucking strip).
 *
 * Expects `qty_move` in scope (same CTE as Contracts / latePerformance).
 */
export function sqlContractInActiveLogisticsOpenOsExpr(opts: {
  contractUuidExpr: string;
  contractNumberExpr: string;
  incotermExpr: string;
}): string {
  const { contractUuidExpr, contractNumberExpr, incotermExpr } = opts;
  const osKg = sqlContractQtyMoveOsKg(contractNumberExpr, incotermExpr);
  const seaActive = `(
    ${sqlIncotermIsSeaLogistics(incotermExpr)}
    AND (
      ${sqlHasActiveSeaShipment(contractUuidExpr)}
      OR (
        NOT ${sqlHasNonCancelledSeaShipment(contractUuidExpr)}
        AND (${osKg}) > ${BACKLOG_OS_COMPLETED_MAX_KG}
      )
    )
  )`;

  const landActive = `(
    ${sqlIncotermIsLandLogistics(incotermExpr)}
    AND (
      ${sqlHasActiveLandTrucking(contractUuidExpr)}
      OR (
        NOT ${sqlHasActiveLandTruckingOp(contractUuidExpr)}
        AND EXISTS (
          SELECT 1
          FROM contracts c_land
          WHERE c_land.id = ${contractUuidExpr}
            AND NOT (${sqlIsContractSapClosedExpr('c_land')})
        )
        AND (${osKg}) > 0
      )
    )
  )`;

  return `(${seaActive} OR ${landActive})`;
}
