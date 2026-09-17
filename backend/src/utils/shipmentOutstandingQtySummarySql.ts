import { OUTSTANDING_QTY_ZERO_TOLERANCE_KG } from './qtyZeroTolerance';
/**
 * Shipments page — Outstanding Qty KPI strip (FOB/CIF/CFR × Interco / 3rd Party).
 *
 * Same OS universe as the six status cards (Unplanned + Preplanned + Planned +
 * At LP + Sailed + At DP). Buckets only add source (3rd Party / Interco) and
 * incoterm (FOB / CIF / CFR) filters on that OS.
 */

import { sqlIsContractSapClosedExpr } from './contractDeliveryStatus';
import { sqlContractGlobalOutstandingExpr } from './contractGlobalOutstandingSql';
import { resolveContractsQtyMoveCte } from '../services/contractQtyMoveSnapshot.service';
import { sqlContractOutstandingFromFields, sqlQtyMoveJoinIncotermDelivery } from './sapIncotermMetrics';
import { sqlCoalesceSourceType } from './sapSourceTypeSql';
import { sqlContractHasResolvedRegionSiteExpr } from './regionSiteSql';
import { shipmentEffectiveStatusExpr } from './shipmentListFilters';
import { shipmentListQtyMoveCteFromPage } from './shipmentOutstandingQtySql';
import {
  appendShipmentPipelineStageFilter,
  normalizeShipmentPagePipelineStageParam,
} from './shipmentPagePipelineSql';
import {
  resolveUnplannedContractBacklogLatestSpdCte,
  preplannedContractBacklogBaseWhereSql,
  sqlBacklogOsStillActiveSql,
  unplannedContractBacklogBaseWhereSql,
} from './shipmentUnplannedHybridSql';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';

export interface ShipmentOutstandingQtyBucketKg {
  fobKg: number;
  cifKg: number;
  cfrKg: number;
}

export interface ShipmentOutstandingQtySummary {
  totalKg: number;
  thirdParty: ShipmentOutstandingQtyBucketKg;
  interco: ShipmentOutstandingQtyBucketKg;
  /**
   * True when FOB/CIF/CFR × source buckets were computed by outstandingQty SQL
   * (not progressive card-total-only placeholder).
   */
  bucketsComplete?: boolean;
  /**
   * Residual OS so that thirdParty + interco + otherKg = totalKg.
   * Shown in helper/tooltip only — not as a 3rd Party / Interco column.
   * True unclassified only: blank/other source_type or non-FOB/CIF/CFR incoterm.
   */
  otherKg?: number;
}

export const EMPTY_SHIPMENT_OUTSTANDING_QTY_SUMMARY: ShipmentOutstandingQtySummary = {
  totalKg: 0,
  thirdParty: { fobKg: 0, cifKg: 0, cfrKg: 0 },
  interco: { fobKg: 0, cifKg: 0, cfrKg: 0 },
  otherKg: 0,
};

const ACTIVE_OS_STATUSES = new Set([
  'UNPLANNED',
  'PREPLANNED',
  'PLANNED',
  'AT_LOADING_PORT',
  'SAILED',
  'AT_DISCHARGE_PORT',
]);

/** SQL: contracts.source_type maps to UI "3rd Party". */
export function sqlShipmentSourceIsThirdParty(expr: string): string {
  return `(
    POSITION('3RD' IN UPPER(TRIM(COALESCE(${expr}, '')))) > 0
    AND POSITION('PARTY' IN UPPER(TRIM(COALESCE(${expr}, '')))) > 0
  )`;
}

/** SQL: contracts.source_type maps to UI "Interco" (Inhouse / Interco). */
export function sqlShipmentSourceIsInterco(expr: string): string {
  const u = `UPPER(TRIM(COALESCE(${expr}, '')))`;
  return `(
    POSITION('INTERCO' IN ${u}) > 0
    OR POSITION('INHOUSE' IN ${u}) > 0
    OR POSITION('IN-HOUSE' IN ${u}) > 0
  )`;
}

export function sqlShipmentIncotermIsFob(expr: string): string {
  return `UPPER(TRIM(COALESCE(${expr}, ''))) = 'FOB'`;
}

export function sqlShipmentIncotermIsCif(expr: string): string {
  return `UPPER(TRIM(COALESCE(${expr}, ''))) = 'CIF'`;
}

export function sqlShipmentIncotermIsCfr(expr: string): string {
  return `UPPER(TRIM(COALESCE(${expr}, ''))) = 'CFR'`;
}

type IncotermBucketKind = 'fob' | 'cif' | 'cfr';

function sqlSumOutstandingBucket(
  outstandingExpr: string,
  sourceExpr: string,
  incotermExpr: string,
  sourceKind: 'third_party' | 'interco',
  incotermKind: IncotermBucketKind,
): string {
  const sourcePred =
    sourceKind === 'third_party'
      ? sqlShipmentSourceIsThirdParty(sourceExpr)
      : sqlShipmentSourceIsInterco(sourceExpr);
  const incotermPred =
    incotermKind === 'fob'
      ? sqlShipmentIncotermIsFob(incotermExpr)
      : incotermKind === 'cif'
        ? sqlShipmentIncotermIsCif(incotermExpr)
        : sqlShipmentIncotermIsCfr(incotermExpr);
  return `COALESCE(SUM(CASE
    WHEN ${sourcePred} AND ${incotermPred} THEN COALESCE((${outstandingExpr})::numeric, 0)
    ELSE 0
  END), 0)`;
}

function sqlSumOutstandingBucketAllIncoterms(
  outstandingExpr: string,
  sourceExpr: string,
  incotermExpr: string,
  sourceKind: 'third_party' | 'interco',
  incotermKind: IncotermBucketKind,
): string {
  return sqlSumOutstandingBucket(outstandingExpr, sourceExpr, incotermExpr, sourceKind, incotermKind);
}

const LOADING_STATUS_GROUP =
  "effective_status IN ('ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING')";
const DISCHARGE_STATUS_GROUP =
  "effective_status IN ('ARRIVED_DP', 'BERTHED_DP', 'UNLOADING')";

/** Card-total OS — same stage sums as status cards (no bucket / source_type gate). */
export function sqlShipmentOutstandingQtyCardExecutionTotalSelect(
  outstandingExpr: string,
  effectiveStatusExpr: string,
  isUnplannedExpr: string,
): string {
  return `(
    COALESCE(SUM(COALESCE(${outstandingExpr}, 0)) FILTER (WHERE ${isUnplannedExpr}), 0)
    + COALESCE(SUM(COALESCE(${outstandingExpr}, 0)) FILTER (WHERE ${effectiveStatusExpr} = 'PLANNED'), 0)
    + COALESCE(SUM(COALESCE(${outstandingExpr}, 0)) FILTER (WHERE ${LOADING_STATUS_GROUP.replace(/effective_status/g, effectiveStatusExpr)}), 0)
    + COALESCE(SUM(COALESCE(${outstandingExpr}, 0)) FILTER (WHERE ${effectiveStatusExpr} = 'SAILED'), 0)
    + COALESCE(SUM(COALESCE(${outstandingExpr}, 0)) FILTER (WHERE ${DISCHARGE_STATUS_GROUP.replace(/effective_status/g, effectiveStatusExpr)}), 0)
  )::numeric AS card_total_kg`;
}

export function sqlShipmentOutstandingQtyAggregateSelect(
  outstandingExpr: string,
  sourceExpr: string,
  incotermExpr: string,
): string {
  const kinds: IncotermBucketKind[] = ['fob', 'cif', 'cfr'];
  const sources: Array<'third_party' | 'interco'> = ['third_party', 'interco'];
  const lines: string[] = [];
  for (const source of sources) {
    for (const kind of kinds) {
      lines.push(
        `${sqlSumOutstandingBucketAllIncoterms(outstandingExpr, sourceExpr, incotermExpr, source, kind)} AS ${source}_${kind}_kg`,
      );
    }
  }
  return lines.join(',\n    ');
}

/** Normalize osStatus query; null means ALL (no extra stage filter). */
export function normalizeShipmentOsStatusParam(raw: unknown): string | null {
  return normalizeShipmentPagePipelineStageParam(
    typeof raw === 'string' ? raw : undefined,
  );
}

/** Completed / Cancelled cards → empty OS (no overlap with active-only scope). */
export function isShipmentOsStatusOutsideActiveScope(osStatus: string | null): boolean {
  if (!osStatus) return false;
  return !ACTIVE_OS_STATUSES.has(osStatus);
}

export function shouldIncludeShipmentUnplannedBacklogForOs(osStatus: string | null): boolean {
  return !osStatus || osStatus === 'UNPLANNED';
}

export function shouldIncludeShipmentPreplannedBacklogForOs(osStatus: string | null): boolean {
  return !osStatus || osStatus === 'PREPLANNED';
}

/** Active pipeline stages for OS strip (excludes COMPLETED / CANCELLED). */
export function sqlShipmentOutstandingActiveStagePredicate(alias: string): string {
  const eff = shipmentEffectiveStatusExpr(alias, {
    dischargeColumn: 'ata_vessel_complete_discharge_own_sto',
  });
  return `(
    ${eff} IN (
      'PLANNED',
      'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING',
      'SAILED',
      'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING'
    )
  )`;
}

/**
 * Execution enrich for Section 1 OS / status-card aggregates — contract fields + qty_move.
 * Avoids sto_metrics / sap_agg (those are list-row grain and dominate cold summary time).
 */
export function sqlShipmentSection1LightExecutionEnrichSelect(alias: string): string {
  const incotermExpr = `COALESCE(NULLIF(TRIM(${alias}.incoterm::text), ''), '')`;
  const sourceExpr = sqlCoalesceSourceType(`${alias}.contract_source_type`);
  return `
        ${shipmentEffectiveStatusExpr(alias, {
          dischargeColumn: 'ata_vessel_complete_discharge_own_sto',
        })} AS effective_status,
        FALSE AS is_unplanned_execution,
        ${sourceExpr} AS source_type,
        ${sourceExpr} AS os_source_type,
        ${incotermExpr} AS incoterm,
        ${incotermExpr} AS os_incoterm,
        ${alias}.contract_numbers`;
}

/** Furthest active pipeline stage wins when one PO sits on multiple STOs. */
export function sqlShipmentActiveStageRankExpr(effectiveStatusExpr: string): string {
  return `CASE
    WHEN ${effectiveStatusExpr} IN ('ARRIVED_DP', 'BERTHED_DP', 'UNLOADING') THEN 5
    WHEN ${effectiveStatusExpr} = 'SAILED' THEN 4
    WHEN ${effectiveStatusExpr} IN ('ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING') THEN 3
    WHEN ${effectiveStatusExpr} = 'PLANNED' THEN 2
    ELSE 1
  END`;
}

/**
 * Collapse execution OS to one row per contract (qty_move, floor 0).
 * Enriched rows must expose contract_numbers, effective_status, os_source_type, os_incoterm.
 */
export function sqlShipmentExecutionOsPerContractCtes(
  enrichedAlias = 'enriched',
  opts: { requireResolvedRegionSite?: boolean } = {},
): string {
  /*
   * `requireResolvedRegionSite` keeps the OS total on the same population Contract Performance
   * counts. Only the OS cards ask for it; the ETC-without-ATC view uses these CTEs to find rows
   * needing attention, and a blank site is no reason to hide one of those.
   */
  const regionSiteFilter = opts.requireResolvedRegionSite
    ? `AND EXISTS (
          SELECT 1 FROM contracts c_rs
          WHERE c_rs.contract_id = TRIM(cn)
            AND ${sqlContractHasResolvedRegionSiteExpr('c_rs.contract_id', 'c_rs.po_number')}
        )`
    : '';
  /*
   * The contract's OWN incoterm decides its bucket and its quantity, not the STO group's.
   *
   * `os_incoterm` is the group's, and an STO group can hold contracts of different incoterms. With
   * the group's value preferred, four trucking contracts landed in the sea OS card as FOB -
   * 1004030388, 1004030695, 1004030753 (FRC, Karawang) and 9184100081 (LCO, Bontang) - and that is
   * not only a wrong bucket: the incoterm selects which delivery column the outstanding quantity
   * reads, so those four were also valued off the vessel column instead of the trucking one.
   * Contract Performance had them at 0-3 MT against 100-750 MT here, 1,050 MT in all
   * (production, 2026-09-16).
   *
   * The group's value stays as the fallback for a contract that carries none of its own.
   */
  const contractOwnIncoterm = `(SELECT c.incoterm FROM contracts c WHERE c.contract_id = r.contract_number LIMIT 1)`;
  /*
   * A contract whose own GR says Close carries no outstanding quantity, whatever its STO group does.
   *
   * `is_contract_sap_closed` on the grouped row is a BOOL_AND across the group's contracts, so a
   * group finishes only when every contract in it has finished. A closed contract sharing an STO
   * with open ones therefore stayed inside the execution arm and kept contributing: 1004029445
   * (FOB, 600 MT), 1004030942 and 1004030943 (CIF, 4 MT each) - 608 MT in production, 2026-09-16.
   *
   * Tested per contract here, where the rows are already split out, rather than by changing the
   * grouped flag - that flag also drives the list's status column, where "every contract closed"
   * is the right question to ask of a row that represents the whole group.
   */
  const contractOwnSapClosed = `EXISTS (
          SELECT 1 FROM contracts c_closed
          WHERE c_closed.contract_id = TRIM(cn)
            AND ${sqlIsContractSapClosedExpr('c_closed')}
        )`;
  const outstandingExpr = sqlContractGlobalOutstandingExpr({
    contractQtyExpr: `(SELECT c.quantity_ordered FROM contracts c WHERE c.contract_id = r.contract_number LIMIT 1)`,
    incotermExpr: `COALESCE(NULLIF(TRIM(${contractOwnIncoterm}), ''), NULLIF(TRIM(r.os_incoterm), ''), '')`,
    contractNumberExpr: 'r.contract_number',
  });
  return `
    execution_os_contracts AS (
      SELECT
        TRIM(cn) AS contract_number,
        ${enrichedAlias}.effective_status,
        ${enrichedAlias}.os_source_type,
        ${enrichedAlias}.os_incoterm,
        ${sqlShipmentActiveStageRankExpr(`${enrichedAlias}.effective_status`)} AS stage_rank
      FROM ${enrichedAlias}
      CROSS JOIN LATERAL unnest(
        regexp_split_to_array(COALESCE(${enrichedAlias}.contract_numbers::text, ''), E'\\\\s*,\\\\s*')
      ) AS cn
      WHERE NULLIF(TRIM(cn), '') IS NOT NULL
        AND ${enrichedAlias}.effective_status IN (
          'PLANNED',
          'ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING',
          'SAILED',
          'ARRIVED_DP', 'BERTHED_DP', 'UNLOADING'
        )
        ${regionSiteFilter}
        AND NOT (${contractOwnSapClosed})
    ),
    execution_os_ranked AS (
      SELECT DISTINCT ON (contract_number)
        contract_number,
        effective_status,
        os_source_type,
        os_incoterm
      FROM execution_os_contracts
      ORDER BY contract_number, stage_rank DESC
    ),
    execution_os_raw AS (
      SELECT
        r.contract_number,
        r.effective_status,
        r.os_source_type AS source_type,
        -- Same rule as the quantity above: the contract's own incoterm decides its bucket, so a
        -- trucking contract sharing an STO group with sea ones is not counted as a sea one.
        COALESCE(NULLIF(TRIM(${contractOwnIncoterm}), ''), NULLIF(TRIM(r.os_incoterm), ''), '') AS incoterm,
        (${outstandingExpr})::numeric AS outstanding_quantity
      FROM execution_os_ranked r
    ),
    /*
     * A shipment with nothing left outstanding is finished, even when no ATC has been recorded
     * and GR still says Open. Trucking has had this (isTruckingPipelineCompleted) and so has the
     * contract-level test (isContractEffectivelyDone); shipment execution rows were the only ones
     * without it, so their residual quantity kept inflating the OS cards forever.
     *
     * Done HERE rather than in shipmentEffectiveStatusExpr on purpose: outstanding_quantity is
     * already computed in this CTE, so the rule costs nothing. The list-row expression has no OS
     * column at all, and bringing one in means pulling OS derivation - the expensive part - into
     * the base CTE of a page that is already slow. That is measured separately before any change.
     *
     * The OS buckets below FILTER on effective_status and there is no 'completed' bucket, so a row
     * that lands here drops out of the OS total entirely rather than merely contributing ~0.
     *
     * CANCELLED is never overridden - a cancelled shipment is not a completed one.
     */
    execution_os AS (
      SELECT
        contract_number,
        source_type,
        incoterm,
        outstanding_quantity,
        CASE
          WHEN UPPER(TRIM(COALESCE(effective_status, ''))) = 'CANCELLED' THEN effective_status
          WHEN outstanding_quantity IS NOT NULL
           AND outstanding_quantity <= ${OUTSTANDING_QTY_ZERO_TOLERANCE_KG}
          THEN 'COMPLETED'
          ELSE effective_status
        END AS effective_status
      FROM execution_os_raw
    )`;
}

function bucketKgFromRow(
  row: Record<string, unknown>,
  prefix: 'third_party' | 'interco',
): ShipmentOutstandingQtyBucketKg {
  return {
    fobKg: Number(row[`${prefix}_fob_kg`] ?? 0) || 0,
    cifKg: Number(row[`${prefix}_cif_kg`] ?? 0) || 0,
    cfrKg: Number(row[`${prefix}_cfr_kg`] ?? 0) || 0,
  };
}

function totalKgFromBuckets(
  thirdParty: ShipmentOutstandingQtyBucketKg,
  interco: ShipmentOutstandingQtyBucketKg,
): number {
  return (
    thirdParty.fobKg +
    thirdParty.cifKg +
    thirdParty.cfrKg +
    interco.fobKg +
    interco.cifKg +
    interco.cfrKg
  );
}

export function parseShipmentOutstandingQtySummaryRow(
  row: Record<string, unknown> | undefined | null,
): ShipmentOutstandingQtySummary {
  if (!row) {
    return { ...EMPTY_SHIPMENT_OUTSTANDING_QTY_SUMMARY, otherKg: 0 };
  }
  const thirdParty = bucketKgFromRow(row, 'third_party');
  const interco = bucketKgFromRow(row, 'interco');
  const classified = totalKgFromBuckets(thirdParty, interco);
  const cardTotalKg =
    row.card_total_kg != null
      ? Number(row.card_total_kg) || 0
      : classified;
  return reconcileShipmentOutstandingQtySummary(
    {
      thirdParty,
      interco,
      totalKg: cardTotalKg,
    },
    cardTotalKg,
  );
}

export function sumShipmentOutstandingQtyClassifiedBucketsKg(
  summary: Pick<ShipmentOutstandingQtySummary, 'thirdParty' | 'interco'>,
): number {
  return totalKgFromBuckets(summary.thirdParty, summary.interco);
}

/**
 * Make strip identity hold: classified (3rd+Interco FOB/CIF/CFR) + otherKg = totalKg.
 * Prefer cardTotalKg (status-card OS sum) when provided so hero matches Section 1 cards.
 */
export function reconcileShipmentOutstandingQtySummary(
  strip: ShipmentOutstandingQtySummary,
  cardTotalKg?: number | null,
): ShipmentOutstandingQtySummary {
  const classified = sumShipmentOutstandingQtyClassifiedBucketsKg(strip);
  const totalKg =
    cardTotalKg != null && Number.isFinite(Number(cardTotalKg))
      ? Number(cardTotalKg) || 0
      : Number(strip.totalKg) || 0;
  return {
    ...strip,
    totalKg,
    otherKg: Math.max(0, totalKg - classified),
  };
}

export function mergeShipmentOutstandingQtySummaries(
  ...parts: ShipmentOutstandingQtySummary[]
): ShipmentOutstandingQtySummary {
  const thirdParty = { fobKg: 0, cifKg: 0, cfrKg: 0 };
  const interco = { fobKg: 0, cifKg: 0, cfrKg: 0 };
  for (const part of parts) {
    thirdParty.fobKg += part.thirdParty.fobKg;
    thirdParty.cifKg += part.thirdParty.cifKg;
    thirdParty.cfrKg += part.thirdParty.cfrKg;
    interco.fobKg += part.interco.fobKg;
    interco.cifKg += part.interco.cifKg;
    interco.cfrKg += part.interco.cfrKg;
  }
  const totalKg = parts.reduce((sum, part) => sum + part.totalKg, 0);
  return reconcileShipmentOutstandingQtySummary(
    {
      thirdParty,
      interco,
      totalKg,
      bucketsComplete: parts.length > 0 && parts.every((part) => part.bucketsComplete === true),
    },
    totalKg,
  );
}

/**
 * Align strip totalKg to the sum of the 6 status-card OS values and recompute Other residual.
 */
export function alignShipmentOutstandingQtyTotalToCardSum(
  strip: ShipmentOutstandingQtySummary,
  cardTotalKg: number,
): ShipmentOutstandingQtySummary {
  return reconcileShipmentOutstandingQtySummary(strip, cardTotalKg);
}

/**
 * Aggregate OS from active shipment execution rows (toolbar-scoped) at contract grain
 * (qty_move, one PO once — furthest active stage wins).
 */
export async function buildShipmentOutstandingQtyExecutionAggregateQuery(
  shipmentBaseCteSql: string,
  toolbarOuterSql: string,
  baseParams: unknown[],
  osStatus: string | null,
): Promise<{ text: string; params: unknown[] }> {
  const stageFilter = appendShipmentPipelineStageFilter(
    osStatus ?? undefined,
    baseParams.length + 1,
  );
  const params = [...baseParams, ...stageFilter.params];

  const text = `
    ${shipmentBaseCteSql}
    , filtered_shipments AS (
      SELECT sb.*
      FROM shipment_base sb
      WHERE 1=1 ${toolbarOuterSql}
        ${stageFilter.sql}
        AND COALESCE(sb.sap_presence, 'PRESENT') = 'PRESENT'
        AND ${sqlShipmentOutstandingActiveStagePredicate('sb')}
    ),
    shipment_page AS (
      SELECT fs.*
      FROM filtered_shipments fs
    ),
    ${await shipmentListQtyMoveCteFromPage()},
    enriched AS (
      SELECT
        ${sqlShipmentSection1LightExecutionEnrichSelect('sp')}
      FROM shipment_page sp
    ),
    ${sqlShipmentExecutionOsPerContractCtes('enriched', { requireResolvedRegionSite: true })}
    SELECT
      ${sqlShipmentOutstandingQtyAggregateSelect(
        'execution_os.outstanding_quantity',
        'execution_os.source_type',
        'execution_os.incoterm',
      )},
      ${sqlShipmentOutstandingQtyCardExecutionTotalSelect(
        'execution_os.outstanding_quantity',
        'execution_os.effective_status',
        'FALSE',
      )}
    FROM execution_os`;

  return { text, params };
}

/**
 * Aggregate OS from open-contract unplanned + preplanned backlog (no shipment yet).
 * Same rows + clamp-at-zero OS as the Unplanned / Preplanned status cards; buckets
 * only slice by COALESCE(contract, SAP) source × effective incoterm.
 */
export async function buildShipmentOutstandingQtyBacklogAggregateQuery(
  contractScopeSql: string,
  toolbarSql: string,
): Promise<string> {
  const unplannedWhere = `${unplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const preplannedWhere = `${preplannedContractBacklogBaseWhereSql('c', 'l')}${contractScopeSql}${toolbarSql}`;
  const outstandingExpr = sqlContractOutstandingFromFields({
    contractQtyExpr: 'c.quantity_ordered',
    incotermExpr: 'c.incoterm',
    receiveExpr: 'qm.quantity_receive',
    deliveryExpr: sqlQtyMoveJoinIncotermDelivery('c.incoterm', 'qm', 'c.transport_mode'),
    clampAtZero: true,
  });
  const sourceExpr = sqlCoalesceSourceType('c.source_type', 'l.source_type_raw');
  const incotermExpr = contractEffectiveIncotermExpr('c');
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT contract_id FROM backlog_contract_ids',
  });

  return `
    WITH ${await resolveUnplannedContractBacklogLatestSpdCte()},
    backlog_contract_ids AS MATERIALIZED (
      SELECT c.id, c.contract_id, TRUE AS is_unplanned, FALSE AS is_preplanned
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${unplannedWhere}
      UNION ALL
      SELECT c.id, c.contract_id, FALSE AS is_unplanned, TRUE AS is_preplanned
      FROM contracts c
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE ${preplannedWhere}
    ),
    ${qtyMoveCte},
    backlog_rows AS (
      SELECT
        /*
         * Carried so this CTE can be listed per contract when the Shipments OS has to be
         * reconciled against Contract Performance. Comparing totals sent that investigation down
         * two wrong explanations; comparing contract by contract ended it in one pass. Projection
         * only - the aggregate below is unchanged.
         */
        c.contract_id AS contract_number,
        ${sourceExpr} AS source_type,
        ${incotermExpr} AS incoterm,
        (${outstandingExpr})::numeric AS outstanding_quantity
      FROM backlog_contract_ids b
      INNER JOIN contracts c ON c.id = b.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      LEFT JOIN qty_move qm ON qm.contract_number = c.contract_id
      WHERE b.is_unplanned
        AND ${sqlBacklogOsStillActiveSql()}
        AND ${sqlContractHasResolvedRegionSiteExpr('c.contract_id', 'c.po_number')}
      UNION ALL
      SELECT
        c.contract_id AS contract_number,
        ${sourceExpr} AS source_type,
        ${incotermExpr} AS incoterm,
        (${outstandingExpr})::numeric AS outstanding_quantity
      FROM backlog_contract_ids b
      INNER JOIN contracts c ON c.id = b.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      LEFT JOIN qty_move qm ON qm.contract_number = c.contract_id
      WHERE b.is_preplanned
        AND ${sqlBacklogOsStillActiveSql()}
        /*
         * Blank Region/Site is excluded from the OS total, not from the backlog itself.
         *
         * Contract Performance counts only contracts that resolve to a real site, and it is the
         * agreed shared reference; the rows stay on the page and in the Unplanned / Preplanned
         * counts, which is why this lives in the OS aggregate rather than in
         * backlog_contract_ids.
         */
        AND ${sqlContractHasResolvedRegionSiteExpr('c.contract_id', 'c.po_number')}
    )
    SELECT
      ${sqlShipmentOutstandingQtyAggregateSelect(
        'br.outstanding_quantity',
        'br.source_type',
        'br.incoterm',
      )},
      COALESCE(SUM(COALESCE(br.outstanding_quantity, 0)), 0)::numeric AS card_total_kg
    FROM backlog_rows br`;
}
