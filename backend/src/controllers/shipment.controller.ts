import { performance } from 'node:perf_hooks';
import { Response } from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { normalizeAndValidateShipmentDailyDeliverables, parseDailyDeliverableQuantity } from '../utils/shipmentDailyDeliverables';
import { parsePlanningSheetToMatrix, toIsoDate10FromCell } from '../utils/planningSheetDate';
import { deriveShipmentStatusFromAta, deriveShipmentStatusFromEta } from '../utils/shipmentStatus';
import {
  appendShipmentColumnFilters,
  appendShipmentEtaBucketFilters,
  appendShipmentGlobalSearch,
  appendShipmentLateIndicatorFilter,
  appendShipmentViewOptionFilter,
  normalizeShipmentEtaBucketParam,
  parseColumnFiltersQuery,
} from '../utils/shipmentListFilters';
import {
  allocateNextSyntheticSequenceDefault,
  buildSyntheticOperationId,
  formatDDMMYYYY,
} from '../utils/operationId';

function shipmentListSummaryPayload(totalCount: number, summaryRow: Record<string, unknown>) {
  return {
    total: totalCount,
    status: {
      planned: Number(summaryRow.planned_count || 0),
      inProgress: Number(summaryRow.in_progress_count || 0),
      loading: Number(summaryRow.loading_count || 0),
      inTransit: Number(summaryRow.in_transit_count || 0),
      arrived: Number(summaryRow.arrived_count || 0),
      unloading: Number(summaryRow.unloading_count || 0),
      completed: Number(summaryRow.completed_count || 0),
      cancelled: Number(summaryRow.cancelled_count || 0),
    },
    etaLoading: {
      moreThan7D: Number(summaryRow.eta_loading_more_than_7d || 0),
      dMinus2: Number(summaryRow.eta_loading_d_minus_2 || 0),
      d: Number(summaryRow.eta_loading_d || 0),
      delay: Number(summaryRow.eta_loading_delay || 0),
      noEta: Number(summaryRow.eta_loading_no_eta || 0),
    },
    etaDischarge: {
      moreThan7D: Number(summaryRow.eta_discharge_more_than_7d || 0),
      dMinus2: Number(summaryRow.eta_discharge_d_minus_2 || 0),
      d: Number(summaryRow.eta_discharge_d || 0),
      delay: Number(summaryRow.eta_discharge_delay || 0),
      noEta: Number(summaryRow.eta_discharge_no_eta || 0),
    },
  };
}

function shouldLogShipmentsTiming(): boolean {
  return process.env.LOG_SHIPMENTS_TIMING === '1' || process.env.NODE_ENV === 'development';
}

function emitShipmentListTimings(
  res: Response,
  timingsMs: Record<string, number>,
  meta: Record<string, unknown>
): void {
  if (!shouldLogShipmentsTiming()) return;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(timingsMs)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const name = k.replace(/[^a-zA-Z0-9_-]/g, '_');
      parts.push(`${name};dur=${v.toFixed(1)}`);
    }
  }
  if (parts.length) {
    res.setHeader('Server-Timing', parts.join(', '));
  }
  logger.info('GET /shipments timings (ms)', { ...timingsMs, ...meta });
  const total = timingsMs.total ?? 0;
  if (total > 2000) {
    logger.warn('GET /shipments slower than 2s target', { totalMs: total, ...meta });
  }
}

export const getShipments = async (req: AuthRequest, res: Response) => {
  let debugSql: { text: string; params: any[] } | null = null;
  const timingsMs: Record<string, number> = {};
  const tReq0 = performance.now();
  try {
    const { status, vessel, port, dateFrom, dateTo, delayed, sto, contract, plant, page = 1, limit = 10 } = req.query;
    const globalSearch =
      typeof (req.query as any).search === 'string' ? (req.query as any).search.trim() : '';
    const colFilters = parseColumnFiltersQuery((req.query as any).columnFilters);
    const lateIndicatorParam = (req.query as any).lateIndicator as string | undefined;
    const viewOptionParam = (req.query as any).viewOption as string | undefined;
    const viewQueryParam = (req.query as any).viewQuery as string | undefined;
    const etaLoadingBucket = normalizeShipmentEtaBucketParam((req.query as any).etaLoading);
    const etaDischargeBucket = normalizeShipmentEtaBucketParam((req.query as any).etaDischarge);
    const offset = (Number(page) - 1) * Number(limit);
    const compact = String((req.query as any).compact || '').toLowerCase() === 'true';
    const includeSummary =
      String((req.query as any).includeSummary ?? 'true').toLowerCase() !== 'false';
    const summaryOnly = String((req.query as any).summaryOnly || '').toLowerCase() === 'true';
    /** Skip heavy SAP table joins (compact list first paint; hydrate with a second request). */
    const skipSapJoin =
      compact &&
      String((req.query as any).skipSapJoin || '').toLowerCase() === 'true' &&
      !summaryOnly;

    // Query shipments grouped by STO number or Operation ID:
    // - SAP shipments are grouped by contracts.sto_number
    // - Manual shipments (no STO) are grouped by operation_id so that multiple contracts
    //   under the same operation appear as a single transaction in the UI
    // Base query for shipments grouped by STO/operation/shipment
    // IMPORTANT: status derivation depends on ATA ladder. Even in compact view, we must
    // fallback to vessel_loading_ports so rows don't incorrectly stay PLANNED.
    // Pre-join first loading / discharge port rows (avoids ~10 correlated subqueries per shipment row).
    const vlpCtes = `
      vlp_load_first AS (
        SELECT DISTINCT ON (shipment_id)
          shipment_id,
          ata_vessel_arrival::date AS vlp_load_ata_va,
          ata_vessel_berthed::date AS vlp_load_ata_vb,
          ata_loading_start::date AS vlp_load_ata_ls,
          ata_loading_completed::date AS vlp_load_ata_lc,
          ata_vessel_sailed::date AS vlp_load_ata_vs
        FROM vessel_loading_ports
        WHERE COALESCE(is_discharge_port, false) = false AND port_sequence = 1
        ORDER BY shipment_id, id
      ),
      vlp_disc_first AS (
        SELECT DISTINCT ON (shipment_id)
          shipment_id,
          ata_vessel_arrival::date AS vlp_disc_ata_va,
          ata_vessel_berthed::date AS vlp_disc_ata_vb,
          ata_loading_start::date AS vlp_disc_ata_ls,
          ata_loading_completed::date AS vlp_disc_ata_lc
        FROM vessel_loading_ports
        WHERE COALESCE(is_discharge_port, false) = true
        ORDER BY shipment_id, port_sequence NULLS LAST, id
      ),`;

    const ataSelect = `
          MAX(COALESCE(s.ata_arrival, vlp_l.vlp_load_ata_va)) as ata_vessel_arrival_at_loading_port,
          MAX(COALESCE(s.ata_berthed, vlp_l.vlp_load_ata_vb)) as ata_vessel_berthed_at_loading_port,
          MAX(COALESCE(s.ata_loading_start, vlp_l.vlp_load_ata_ls)) as ata_vessel_start_loading,
          MAX(COALESCE(s.ata_loading_complete, vlp_l.vlp_load_ata_lc)) as ata_vessel_completed_loading,
          MAX(COALESCE(s.ata_sailed, vlp_l.vlp_load_ata_vs)) as ata_vessel_sailed_from_loading_port,
          MAX(COALESCE(s.ata_discharge_arrival, vlp_d.vlp_disc_ata_va)) as ata_vessel_arrive_at_discharge_port,
          MAX(COALESCE(s.ata_discharge_berthed, vlp_d.vlp_disc_ata_vb)) as ata_vessel_berthed_at_discharge_port,
          MAX(COALESCE(s.ata_discharge_start, vlp_d.vlp_disc_ata_ls)) as ata_vessel_start_discharging,
          MAX(COALESCE(s.ata_discharge_complete, vlp_d.vlp_disc_ata_lc)) as ata_vessel_complete_discharge,`;

    const etaExtraSelect = compact
      ? `
          -- ETA discharge complete (compact): shipment-level only
          MAX(s.eta_discharge_complete) as eta_vessel_complete_discharge,`
      : `
          -- Get ETA dates from shipments or vessel_loading_ports
          MAX(COALESCE(s.eta_discharge_complete, (SELECT vlpd.eta_vessel_complete_discharge::date FROM vessel_loading_ports vlpd WHERE vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true LIMIT 1))) as eta_vessel_complete_discharge,`;

    const contractMetaSelect = compact
      ? `
          NULL::text AS contract_reference_po,
          NULL::text AS contract_ext_no`
      : `
          -- Get contract reference PO from contracts or sap_processed_data
          MAX((SELECT COALESCE(
                  spd.data->'contract'->>'contract_reference_po',
                  spd.data->>'CONTRACT REFF PO'
                )
           FROM sap_processed_data spd
           WHERE TRIM(spd.sto_number::text) = TRIM(COALESCE(c.sto_number::text, l.effective_sto, s.shipment_id))
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1)) AS contract_reference_po,
          -- Get Contract Ext No from sap_processed_data
          MAX((SELECT COALESCE(
                  spd.data->'raw'->>'Contract Ext No',
                  spd.data->>'Contract Ext No'
                )
           FROM sap_processed_data spd
           WHERE TRIM(spd.sto_number::text) = TRIM(COALESCE(c.sto_number::text, l.effective_sto, s.shipment_id))
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1)) AS contract_ext_no`;

    const seaCond = `UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) = 'SEA'`;
    const stoIsSet = Boolean(sto && String(sto).trim() !== '');
    /** STO filter may depend on SAP effective_sto — keep full latest_spd scan in that case. */
    const scopeLatestSpdToContracts = !stoIsSet;

    const coreWhereParts: string[] = [seaCond];
    const coreParams: any[] = [];
    let cp = 1;

    if (status) {
      coreWhereParts.push(`s.status = $${cp}`);
      coreParams.push(status);
      cp += 1;
    }
    if (vessel) {
      coreWhereParts.push(`s.vessel_name ILIKE $${cp}`);
      coreParams.push(`%${vessel}%`);
      cp += 1;
    }
    if (port) {
      coreWhereParts.push(`(s.port_of_loading ILIKE $${cp} OR s.port_of_discharge ILIKE $${cp + 1})`);
      coreParams.push(`%${port}%`, `%${port}%`);
      cp += 2;
    }
    if (dateFrom) {
      coreWhereParts.push(`c.contract_date >= $${cp}`);
      coreParams.push(dateFrom);
      cp += 1;
    }
    if (dateTo) {
      coreWhereParts.push(`c.contract_date <= $${cp}`);
      coreParams.push(dateTo);
      cp += 1;
    }
    if (delayed === 'true') {
      coreWhereParts.push(`s.is_delayed = true`);
    }
    if (contract) {
      coreWhereParts.push(`c.contract_id = $${cp}`);
      coreParams.push(contract);
      cp += 1;
    }
    const plantListRaw = Array.isArray(plant) ? plant : plant ? [plant] : [];
    const plants = plantListRaw.map((v) => String(v).trim()).filter(Boolean);
    if (plants.length > 0) {
      // Plant/Site filter (same options as Dashboard). Matches discharge port.
      coreWhereParts.push(`NULLIF(TRIM(COALESCE(s.port_of_discharge::text, '')), '') = ANY($${cp}::text[])`);
      coreParams.push(plants);
      cp += 1;
    }

    const coreWhereSql = coreWhereParts.join(' AND ');

    const latestSpdSelectList = `
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no',
            spd.data->'contract'->>'sto_no'
          )), '') AS effective_sto,
          COALESCE(
            spd.data->'contract'->>'contract_type',
            spd.data->>'B2B Flag',
            spd.data->'raw'->>'B2B Flag',
            spd.data->>'Contract Type'
          ) AS b2b_flag_raw,
          COALESCE(
            spd.data->'contract'->>'contract_reference_po',
            spd.data->>'CONTRACT REFF PO',
            spd.data->>'Contract Reff PO Ini',
            spd.data->'raw'->>'Contract Reff PO Ini',
            spd.data->'raw'->>'CONTRACT REFF PO'
          ) AS contract_reference_po_raw,
          spd.created_at`;

    const prelude = scopeLatestSpdToContracts
      ? `WITH ${vlpCtes}
      relevant_contract_numbers AS (
        SELECT DISTINCT c.contract_id
        FROM shipments s
        INNER JOIN contracts c ON s.contract_id = c.id
        WHERE ${coreWhereSql}
      ),
      latest_spd_contract AS (
        ${latestSpdSelectList}
        FROM sap_processed_data spd
        INNER JOIN relevant_contract_numbers rc ON rc.contract_id = spd.contract_number
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      shipment_base AS (
        SELECT 
`
      : `WITH ${vlpCtes}
      latest_spd_contract AS (
        ${latestSpdSelectList}
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      shipment_base AS (
        SELECT 
`;

    let queryText = `${prelude}
          COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id) as sto_key,
          (array_agg(s.id ORDER BY s.created_at DESC) FILTER (WHERE s.id IS NOT NULL))[1] as id,
          MAX(COALESCE(c.sto_number::text, l.effective_sto)) as sto_number,
          MAX(s.shipment_id) as shipment_id,
          MAX(s.operation_id) as operation_id,
          MAX(s.vessel_name) as vessel_name,
          MAX(s.vessel_code) as vessel_code,
          MAX(s.voyage_no) as voyage_no,
          MAX(s.vessel_owner) as vessel_owner,
          MAX(s.vessel_draft) as vessel_draft,
          MAX(s.vessel_loa) as vessel_loa,
          MAX(s.vessel_capacity) as vessel_capacity,
          MAX(s.vessel_hull_type) as vessel_hull_type,
          MAX(s.vessel_registration_year) as vessel_registration_year,
          MAX(s.charter_type) as charter_type,
          MAX(s.shipment_date) as shipment_date,
          MAX(s.arrival_date) as arrival_date,
          MAX(s.port_of_loading) as port_of_loading,
          MAX(s.port_of_discharge) as port_of_discharge,
          MAX(s.port_of_discharge) as plant_site,
          -- Basic ETA loading dates at shipment level (kept in sync with first loading port)
          MAX(s.eta_arrival) as eta_arrival,
          MAX(s.eta_berthed) as eta_berthed,
          MAX(s.eta_loading_start) as eta_loading_start,
          MAX(s.eta_loading_complete) as eta_loading_complete,
          MAX(s.eta_sailed) as eta_sailed,
          -- Basic ETA discharge dates at shipment level
          MAX(s.eta_discharge_arrival) as eta_discharge_arrival,
          MAX(s.eta_discharge_berthed) as eta_discharge_berthed,
          MAX(s.eta_discharge_start) as eta_discharge_start,
          MAX(s.eta_discharge_complete) as eta_discharge_complete,
          COALESCE(SUM(s.quantity_shipped), 0) as quantity_shipped,
          COALESCE(SUM(s.quantity_delivered), 0) as quantity_delivered,
          COALESCE(SUM(s.inbound_weight), 0) as inbound_weight,
          COALESCE(SUM(s.outbound_weight), 0) as outbound_weight,
          COALESCE(AVG(s.gain_loss_percentage), 0) as gain_loss_percentage,
          COALESCE(SUM(s.gain_loss_amount), 0) as gain_loss_amount,
          MAX(s.estimated_km) as estimated_km,
          MAX(s.estimated_nautical_miles) as estimated_nautical_miles,
          MAX(s.vessel_oa_budget) as vessel_oa_budget,
          MAX(s.vessel_oa_actual) as vessel_oa_actual,
          MAX(s.bl_quantity) as bl_quantity,
          MAX(s.actual_vessel_qty_receive) as actual_vessel_qty_receive,
          MAX(s.difference_final_qty_vs_bl_qty) as difference_final_qty_vs_bl_qty,
          MAX(s.average_vessel_speed) as average_vessel_speed,
          MAX(s.status) as status,
          MAX(s.sla_days) as sla_days,
          BOOL_OR(s.is_delayed) as is_delayed,
          MAX(s.sap_delivery_id) as sap_delivery_id,
          MAX(s.created_at) as created_at,
          MAX(s.updated_at) as updated_at,
          -- Aggregate contract data
          STRING_AGG(DISTINCT c.contract_id, ', ' ORDER BY c.contract_id) FILTER (WHERE c.contract_id IS NOT NULL) as contract_numbers,
          STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL AND c.po_number != '') as po_numbers,
          MAX(c.supplier) as supplier,
          STRING_AGG(DISTINCT c.supplier, ', ' ORDER BY c.supplier) FILTER (WHERE c.supplier IS NOT NULL) as suppliers,
          MAX(c.buyer) as buyer,
          STRING_AGG(DISTINCT c.buyer, ', ' ORDER BY c.buyer) FILTER (WHERE c.buyer IS NOT NULL) as buyers,
          MAX(c.product) as product,
          STRING_AGG(DISTINCT c.product, ', ' ORDER BY c.product) FILTER (WHERE c.product IS NOT NULL) as products,
          MAX(c.group_name) as group_name,
          STRING_AGG(DISTINCT c.group_name, ', ' ORDER BY c.group_name) FILTER (WHERE c.group_name IS NOT NULL) as group_names,
          COUNT(DISTINCT c.contract_id) FILTER (WHERE c.contract_id IS NOT NULL) as contract_count,
          -- Get delivery dates from contracts
          MAX(c.delivery_start_date) as delivery_start_date,
          MAX(c.delivery_end_date) as delivery_end_date,
${ataSelect}
${etaExtraSelect}
${contractMetaSelect}
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        LEFT JOIN vlp_load_first vlp_l ON vlp_l.shipment_id = s.id
        LEFT JOIN vlp_disc_first vlp_d ON vlp_d.shipment_id = s.id
        WHERE 1=1
          AND (${coreWhereSql})
          -- Match dashboard baseline: exclude B2B "child" contracts
          -- (latest SAP row indicates B2B AND Contract Reference PO is not blank).
          AND NOT (
            l.contract_number IS NOT NULL
            AND UPPER(NULLIF(TRIM(COALESCE(l.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
            AND NULLIF(TRIM(COALESCE(l.contract_reference_po_raw, '')), '') IS NOT NULL
          )
    `;
    const queryParams: any[] = [...coreParams];
    let paramIndex = coreParams.length + 1;

    if (stoIsSet) {
      queryText += ` AND (
        TRIM(COALESCE(c.sto_number::text, l.effective_sto, '')) = TRIM($${paramIndex}::text)
        OR s.shipment_id = $${paramIndex}
        OR TRIM(COALESCE(s.operation_id::text, '')) = TRIM($${paramIndex}::text)
      )`;
      queryParams.push(sto);
      paramIndex++;
    }

    const innerParams = [...queryParams];
    const outerFilterStartIndex = paramIndex;

    // NOTE: We intentionally avoid per-row correlated subqueries into sap_processed_data here.
    // Those are extremely slow when sap_processed_data is large, causing the shipments page to hang.

    queryText += `
        GROUP BY COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id)
      )`;

    /** Full grouped dataset (expensive on large YTD). Used for summary aggregates. */
    const shipmentBaseCteSqlFull = queryText;

    const stoKeyExpr =
      'COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id)';

    let fp = outerFilterStartIndex;
    const gSearch = appendShipmentGlobalSearch(globalSearch, fp);
    fp = gSearch.nextIndex;
    const cCol = appendShipmentColumnFilters(colFilters, fp);
    fp = cCol.nextIndex;
    const li = appendShipmentLateIndicatorFilter(lateIndicatorParam, fp);
    fp = li.nextIndex;
    const vo = appendShipmentViewOptionFilter(viewOptionParam, viewQueryParam, fp);
    fp = vo.nextIndex;
    const etaBuckets = appendShipmentEtaBucketFilters(etaLoadingBucket, etaDischargeBucket);

    const outerSql = `${gSearch.sql}${cCol.sql}${li.sql}${vo.sql}${etaBuckets.sql}`;
    const outerParams = [...gSearch.params, ...cCol.params, ...li.params, ...vo.params];
    const countParams = [...innerParams, ...outerParams];

    /**
     * Default list view (YTD, no toolbar filters): aggregate only the current page's STO keys.
     * Otherwise shipment_base materializes every STO group in-range before LIMIT — O(all rows).
     */
    const listUsesStoPaging =
      !summaryOnly &&
      !stoIsSet &&
      !gSearch.sql &&
      !cCol.sql &&
      !li.sql &&
      !vo.sql &&
      !etaBuckets.sql;

    const rankedStoCte = `
      ranked_sto AS (
        SELECT ${stoKeyExpr} AS sto_key,
          MAX(s.created_at) AS mx
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE 1=1
          AND (${coreWhereSql})
          AND NOT (
            l.contract_number IS NOT NULL
            AND UPPER(NULLIF(TRIM(COALESCE(l.b2b_flag_raw, c.contract_type::text, '')), '')) = 'B2B'
            AND NULLIF(TRIM(COALESCE(l.contract_reference_po_raw, '')), '') IS NOT NULL
          )
        GROUP BY 1
      ),`;

    let shipmentBaseCteSqlList = shipmentBaseCteSqlFull;
    if (listUsesStoPaging) {
      const pagedStoCte = `
      paged_sto AS (
        SELECT sto_key FROM ranked_sto
        ORDER BY mx DESC
        LIMIT $${outerFilterStartIndex} OFFSET $${outerFilterStartIndex + 1}
      ),`;
      shipmentBaseCteSqlList = shipmentBaseCteSqlFull.replace(
        ',\n      shipment_base AS (',
        `,${rankedStoCte}${pagedStoCte}
      shipment_base AS (`,
      );
      if (shipmentBaseCteSqlList === shipmentBaseCteSqlFull) {
        shipmentBaseCteSqlList = shipmentBaseCteSqlFull.replace(
          ',      shipment_base AS (',
          `,${rankedStoCte}${pagedStoCte}
      shipment_base AS (`,
        );
      }
      shipmentBaseCteSqlList = shipmentBaseCteSqlList.replace(
        '        GROUP BY COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id)',
        `          AND (${stoKeyExpr}) IN (SELECT sto_key FROM paged_sto)
        GROUP BY COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id)`,
      );
    }

    /** If string replace failed, fall back to full scan (correctness over fast path). */
    const effectiveListStoPaging =
      listUsesStoPaging && shipmentBaseCteSqlList.includes('ranked_sto AS');
    if (listUsesStoPaging && !effectiveListStoPaging) {
      shipmentBaseCteSqlList = shipmentBaseCteSqlFull;
    }

    const summaryCountQuery = `${shipmentBaseCteSqlFull}
      , filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${outerSql}
      ),
      enriched AS (
        SELECT
          f.*,
          CASE
            WHEN UPPER(TRIM(COALESCE(f.status, ''))) = 'CANCELLED' THEN 'CANCELLED'
            WHEN (
              f.ata_vessel_arrival_at_loading_port IS NOT NULL AND
              f.ata_vessel_berthed_at_loading_port IS NOT NULL AND
              f.ata_vessel_start_loading IS NOT NULL AND
              f.ata_vessel_completed_loading IS NOT NULL AND
              f.ata_vessel_sailed_from_loading_port IS NOT NULL AND
              f.ata_vessel_arrive_at_discharge_port IS NOT NULL AND
              f.ata_vessel_berthed_at_discharge_port IS NOT NULL AND
              f.ata_vessel_start_discharging IS NOT NULL AND
              f.ata_vessel_complete_discharge IS NOT NULL
            ) THEN 'COMPLETED'
            ELSE (
              CASE
                WHEN NOT (
                  f.eta_arrival IS NOT NULL OR f.eta_berthed IS NOT NULL OR f.eta_loading_start IS NOT NULL OR f.eta_loading_complete IS NOT NULL OR f.eta_sailed IS NOT NULL
                  OR f.eta_discharge_arrival IS NOT NULL OR f.eta_discharge_berthed IS NOT NULL OR f.eta_discharge_start IS NOT NULL OR f.eta_vessel_complete_discharge IS NOT NULL
                ) THEN 'PLANNED'
                WHEN (
                  f.eta_arrival IS NOT NULL AND f.eta_berthed IS NOT NULL AND f.eta_loading_start IS NOT NULL AND f.eta_loading_complete IS NOT NULL AND f.eta_sailed IS NOT NULL
                  AND f.eta_discharge_arrival IS NOT NULL AND f.eta_discharge_berthed IS NOT NULL
                ) THEN 'UNLOADING'
                WHEN (
                  f.eta_arrival IS NOT NULL AND f.eta_berthed IS NOT NULL AND f.eta_loading_start IS NOT NULL AND f.eta_loading_complete IS NOT NULL AND f.eta_sailed IS NOT NULL
                  AND f.eta_discharge_arrival IS NOT NULL
                ) THEN 'ARRIVED'
                WHEN (
                  f.eta_arrival IS NOT NULL AND f.eta_berthed IS NOT NULL AND f.eta_loading_start IS NOT NULL AND f.eta_loading_complete IS NOT NULL AND f.eta_sailed IS NOT NULL
                ) THEN 'IN_TRANSIT'
                WHEN (f.eta_arrival IS NOT NULL AND f.eta_loading_start IS NOT NULL) THEN 'LOADING'
                WHEN (f.eta_arrival IS NOT NULL) THEN 'IN_PROGRESS'
                ELSE 'PLANNED'
              END
            )
          END AS effective_status,
          (
            f.eta_arrival IS NULL AND f.eta_berthed IS NULL AND f.eta_loading_start IS NULL AND f.eta_loading_complete IS NULL AND f.eta_sailed IS NULL
          ) AS loading_no_eta,
          (
            (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) < 0) OR
            (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) < 0) OR
            (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) < 0) OR
            (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) < 0) OR
            (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) < 0)
          ) AS loading_delay,
          (
            (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) = 0) OR
            (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) = 0) OR
            (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) = 0) OR
            (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) = 0) OR
            (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) = 0)
          ) AS loading_d,
          (
            (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) BETWEEN 1 AND 2)
          ) AS loading_d_minus_2,
          (
            (f.eta_arrival IS NOT NULL AND (f.eta_arrival::date - CURRENT_DATE) > 7) OR
            (f.eta_berthed IS NOT NULL AND (f.eta_berthed::date - CURRENT_DATE) > 7) OR
            (f.eta_loading_start IS NOT NULL AND (f.eta_loading_start::date - CURRENT_DATE) > 7) OR
            (f.eta_loading_complete IS NOT NULL AND (f.eta_loading_complete::date - CURRENT_DATE) > 7) OR
            (f.eta_sailed IS NOT NULL AND (f.eta_sailed::date - CURRENT_DATE) > 7)
          ) AS loading_more_than_7d,
          (
            f.eta_discharge_arrival IS NULL AND f.eta_discharge_berthed IS NULL AND f.eta_discharge_start IS NULL AND f.eta_vessel_complete_discharge IS NULL
          ) AS discharge_no_eta,
          (
            (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) < 0) OR
            (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) < 0) OR
            (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) < 0) OR
            (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) < 0)
          ) AS discharge_delay,
          (
            (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) = 0) OR
            (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) = 0) OR
            (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) = 0) OR
            (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) = 0)
          ) AS discharge_d,
          (
            (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) BETWEEN 1 AND 2) OR
            (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) BETWEEN 1 AND 2)
          ) AS discharge_d_minus_2,
          (
            (f.eta_discharge_arrival IS NOT NULL AND (f.eta_discharge_arrival::date - CURRENT_DATE) > 7) OR
            (f.eta_discharge_berthed IS NOT NULL AND (f.eta_discharge_berthed::date - CURRENT_DATE) > 7) OR
            (f.eta_discharge_start IS NOT NULL AND (f.eta_discharge_start::date - CURRENT_DATE) > 7) OR
            (f.eta_vessel_complete_discharge IS NOT NULL AND (f.eta_vessel_complete_discharge::date - CURRENT_DATE) > 7)
          ) AS discharge_more_than_7d
        FROM filtered_shipments f
      )
      SELECT
        COUNT(*)::bigint AS total_count,
        COUNT(*) FILTER (WHERE effective_status = 'PLANNED')::bigint AS planned_count,
        COUNT(*) FILTER (WHERE effective_status = 'IN_PROGRESS')::bigint AS in_progress_count,
        COUNT(*) FILTER (WHERE effective_status = 'LOADING')::bigint AS loading_count,
        COUNT(*) FILTER (WHERE effective_status = 'IN_TRANSIT')::bigint AS in_transit_count,
        COUNT(*) FILTER (WHERE effective_status = 'ARRIVED')::bigint AS arrived_count,
        COUNT(*) FILTER (WHERE effective_status = 'UNLOADING')::bigint AS unloading_count,
        COUNT(*) FILTER (WHERE effective_status = 'COMPLETED')::bigint AS completed_count,
        COUNT(*) FILTER (WHERE effective_status = 'CANCELLED')::bigint AS cancelled_count,
        COUNT(*) FILTER (WHERE loading_no_eta)::bigint AS eta_loading_no_eta,
        COUNT(*) FILTER (WHERE NOT loading_no_eta AND loading_delay)::bigint AS eta_loading_delay,
        COUNT(*) FILTER (WHERE NOT loading_no_eta AND NOT loading_delay AND loading_d)::bigint AS eta_loading_d,
        COUNT(*) FILTER (WHERE NOT loading_no_eta AND NOT loading_delay AND NOT loading_d AND loading_d_minus_2)::bigint AS eta_loading_d_minus_2,
        COUNT(*) FILTER (WHERE NOT loading_no_eta AND NOT loading_delay AND NOT loading_d AND NOT loading_d_minus_2 AND loading_more_than_7d)::bigint AS eta_loading_more_than_7d,
        COUNT(*) FILTER (WHERE discharge_no_eta)::bigint AS eta_discharge_no_eta,
        COUNT(*) FILTER (WHERE NOT discharge_no_eta AND discharge_delay)::bigint AS eta_discharge_delay,
        COUNT(*) FILTER (WHERE NOT discharge_no_eta AND NOT discharge_delay AND discharge_d)::bigint AS eta_discharge_d,
        COUNT(*) FILTER (WHERE NOT discharge_no_eta AND NOT discharge_delay AND NOT discharge_d AND discharge_d_minus_2)::bigint AS eta_discharge_d_minus_2,
        COUNT(*) FILTER (WHERE NOT discharge_no_eta AND NOT discharge_delay AND NOT discharge_d AND NOT discharge_d_minus_2 AND discharge_more_than_7d)::bigint AS eta_discharge_more_than_7d
      FROM enriched`;

    if (summaryOnly) {
      const tSum0 = performance.now();
      const summaryResult = await query(summaryCountQuery, countParams);
      timingsMs.dbSummaryOnly = performance.now() - tSum0;
      timingsMs.total = performance.now() - tReq0;
      emitShipmentListTimings(res, timingsMs, {
        path: 'summaryOnly',
        compact,
        skipSapJoin,
        effectiveListStoPaging,
        page: Number(page),
        limit: Number(limit),
      });
      const sr = (summaryResult.rows[0] || {}) as Record<string, unknown>;
      const tc = parseInt(String(sr.total_count ?? '0'), 10) || 0;
      return res.json({
        success: true,
        data: {
          shipments: [],
          summary: shipmentListSummaryPayload(tc, sr),
          pagination: {
            total: tc,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(tc / Number(limit)) || 0,
          },
        },
      });
    }

    const shipmentPageCte = effectiveListStoPaging
      ? `shipment_page AS (
        SELECT
          fs.*,
          (SELECT COUNT(*)::bigint FROM ranked_sto) AS __filter_total
        FROM filtered_shipments fs
        ORDER BY fs.created_at DESC
      )`
      : `shipment_page AS (
        SELECT
          fs.*,
          (SELECT COUNT(*)::bigint FROM filtered_shipments) AS __filter_total
        FROM filtered_shipments fs
        ORDER BY fs.created_at DESC
        LIMIT $${fp} OFFSET $${fp + 1}
      )`;

    const spdAggCtesFull = `
      spd_keyed AS (
        /*
         * Key SAP rows to the *page* sto_key.
         * Primary join: STO-based match (fast when STO exists).
         * Fallback join: contract_number is one of the shipment_page.contract_numbers (needed for synthetic OP-SEA-* rows).
         */
        SELECT
          sp.sto_key,
          spd.created_at,
          spd.data
        FROM shipment_page sp
        INNER JOIN sap_processed_data spd
          ON (
            NULLIF(TRIM(COALESCE(
              spd.sto_number::text,
              spd.data->'raw'->>'STO No.',
              spd.data->'raw'->>'STO Number',
              spd.data->'shipment'->>'sto_no',
              spd.data->'contract'->>'sto_no'
            )), '') = TRIM(sp.sto_key::text)
            OR (
              spd.contract_number IS NOT NULL
              AND sp.contract_numbers IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM unnest(regexp_split_to_array(sp.contract_numbers, ',')) AS cn
                WHERE TRIM(cn) = TRIM(spd.contract_number::text)
              )
            )
          )
        WHERE sp.sto_key IS NOT NULL AND TRIM(sp.sto_key::text) != ''
      ),
      contract_ext_agg AS (
        SELECT
          q.sto_key,
          STRING_AGG(DISTINCT q.v, ', ' ORDER BY q.v) AS contract_ext_no
        FROM (
          SELECT
            sk.sto_key,
            NULLIF(TRIM(COALESCE(
              sk.data->'raw'->>'Contract Ext No',
              sk.data->>'Contract Ext No'
            )), '') AS v
          FROM spd_keyed sk
        ) q
        WHERE q.v IS NOT NULL AND q.v != ''
        GROUP BY q.sto_key
      ),
      sap_agg AS (
        SELECT
          sk.sto_key,
          COALESCE(SUM(
            NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(sk.data->'contract'->>'sto_quantity'), ''),
              NULLIF(TRIM(sk.data->'shipment'->>'sto_quantity'), ''),
              NULLIF(TRIM(sk.data->'raw'->>'STO Quantity'), ''),
              NULLIF(TRIM(sk.data->'raw'->>'sto quantity'), '')
              , ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric
          ), 0) AS sto_quantity,
          COALESCE(SUM(
            NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(sk.data->'raw'->>'Quantity Receive'), ''),
              NULLIF(TRIM(sk.data->'raw'->>'Qty Receive'), '')
              , ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric
          ), 0) AS quantity_receive,
          COALESCE(SUM(
            NULLIF(regexp_replace(COALESCE(
              NULLIF(TRIM(sk.data->'raw'->>'Quantity Delivered'), ''),
              NULLIF(TRIM(sk.data->'raw'->>'Quantity Delivery'), '')
              , ''
            ), '[^0-9\\.-]', '', 'g'), '')::numeric
          ), 0) AS quantity_delivered_sap
        FROM spd_keyed sk
        WHERE sk.sto_key IS NOT NULL
        GROUP BY sk.sto_key
      ),
      sap_latest AS (
        SELECT DISTINCT ON (sk.sto_key)
          sk.sto_key,
          COALESCE(sk.data->'contract'->>'incoterm', sk.data->>'Incoterm') AS incoterm,
          COALESCE(sk.data->'contract'->>'contract_type', sk.data->>'B2B Flag', sk.data->>'Contract Type') AS b2b_flag,
          COALESCE(sk.data->'contract'->>'source_type', sk.data->>'Source') AS source_type
        FROM spd_keyed sk
        WHERE sk.sto_key IS NOT NULL
        ORDER BY sk.sto_key, sk.created_at DESC NULLS LAST
      )`;

    const spdAggCtesStub = `
      spd_keyed AS (
        SELECT NULL::text AS sto_key, NULL::timestamptz AS created_at, NULL::jsonb AS data
        WHERE false
      ),
      contract_ext_agg AS (
        SELECT NULL::text AS sto_key, NULL::text AS contract_ext_no WHERE false
      ),
      sap_agg AS (
        SELECT NULL::text AS sto_key,
          0::numeric AS sto_quantity,
          0::numeric AS quantity_receive,
          0::numeric AS quantity_delivered_sap
        WHERE false
      ),
      sap_latest AS (
        SELECT NULL::text AS sto_key,
          NULL::text AS incoterm,
          NULL::text AS b2b_flag,
          NULL::text AS source_type
        WHERE false
      )`;

    const spdAggCtes = skipSapJoin ? spdAggCtesStub : spdAggCtesFull;

    queryText = `${shipmentBaseCteSqlList},
      filtered_shipments AS (
        SELECT sb.*
        FROM shipment_base sb
        WHERE 1=1 ${outerSql}
      ),
      ${shipmentPageCte},
      ${spdAggCtes}
      SELECT 
        sp.*,
        COALESCE(sa.sto_quantity, 0) AS sto_quantity,
        COALESCE(sa.quantity_receive, 0) AS quantity_receive,
        COALESCE(sa.quantity_delivered_sap, 0) AS quantity_delivered_sap,
        sl.incoterm AS incoterm,
        sl.b2b_flag AS b2b_flag,
        sl.source_type AS source_type,
        COALESCE(cex.contract_ext_no, sp.contract_ext_no) AS contract_ext_no_merged
      FROM shipment_page sp
      LEFT JOIN sap_agg sa ON TRIM(sa.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN sap_latest sl ON TRIM(sl.sto_key::text) = TRIM(sp.sto_key::text)
      LEFT JOIN contract_ext_agg cex ON TRIM(cex.sto_key::text) = TRIM(sp.sto_key::text)`;
    const mainParams = [...innerParams, ...outerParams, Number(limit), offset];

    debugSql = { text: queryText, params: mainParams };
    const tMain0 = performance.now();
    const result = await query(queryText, mainParams);
    timingsMs.dbMainList = performance.now() - tMain0;

    let totalCount =
      result.rows.length > 0 && (result.rows[0] as { __filter_total?: unknown }).__filter_total != null
        ? parseInt(String((result.rows[0] as { __filter_total?: unknown }).__filter_total), 10)
        : 0;
    if (result.rows.length === 0) {
      let emptyCountSql: string;
      let emptyParams: any[];
      if (effectiveListStoPaging) {
        const beforePaged = shipmentBaseCteSqlList.split(/,\s*paged_sto AS\s*\(/)[0];
        emptyCountSql = `${beforePaged}
      SELECT COUNT(*)::bigint AS c FROM ranked_sto`;
        emptyParams = innerParams;
      } else {
        emptyCountSql = `${shipmentBaseCteSqlList},
      filtered_shipments AS (
        SELECT sb.* FROM shipment_base sb WHERE 1=1 ${outerSql}
      )
      SELECT COUNT(*)::bigint AS c FROM filtered_shipments`;
        emptyParams = [...innerParams, ...outerParams];
      }
      const tEc0 = performance.now();
      const emptyRes = await query(emptyCountSql, emptyParams);
      timingsMs.dbEmptyCount = performance.now() - tEc0;
      totalCount = parseInt(emptyRes.rows[0]?.c, 10) || 0;
    }

    // When grouping by STO, display STO No from sto_key when contracts.sto_number is empty,
    // but only if sto_key looks like a real STO number (numeric), not an operation ID or manual code.
    for (const row of result.rows) {
      delete (row as { __filter_total?: unknown }).__filter_total;
      if (Object.prototype.hasOwnProperty.call(row, 'contract_ext_no_merged')) {
        row.contract_ext_no = row.contract_ext_no_merged as string | null;
        delete (row as { contract_ext_no_merged?: unknown }).contract_ext_no_merged;
      }

      // Preserve explicit cancellations.
      if (String(row.status ?? '').trim().toUpperCase() === 'CANCELLED') {
        row.status = 'CANCELLED';
        continue;
      }

      const currentStoNumber = row.sto_number;
      const stoKeyStr = row.sto_key != null ? String(row.sto_key).trim() : '';

      if (
        (currentStoNumber == null || String(currentStoNumber).trim() === '') &&
        stoKeyStr &&
        /^\d+$/.test(stoKeyStr) // treat only purely numeric values as valid STO numbers
      ) {
        row.sto_number = stoKeyStr;
      }

      // Auto-derive SEA shipment status for consistent UI:
      // - COMPLETED only when full ATA ladder exists
      // - otherwise derive from ETA ladder
      const ataDerived = deriveShipmentStatusFromAta({
        ata_arrival_at_loading_port: row.ata_vessel_arrival_at_loading_port,
        ata_berthed_at_loading_port: row.ata_vessel_berthed_at_loading_port,
        ata_start_loading: row.ata_vessel_start_loading,
        ata_completed_loading: row.ata_vessel_completed_loading,
        ata_sailed_from_loading_port: row.ata_vessel_sailed_from_loading_port,
        ata_arrive_at_discharge_port: row.ata_vessel_arrive_at_discharge_port,
        ata_berthed_at_discharge_port: row.ata_vessel_berthed_at_discharge_port,
        ata_start_discharging: row.ata_vessel_start_discharging,
        ata_complete_discharge: row.ata_vessel_complete_discharge,
      });
      if (ataDerived === 'COMPLETED') {
        row.status = 'COMPLETED';
      } else {
        row.status = deriveShipmentStatusFromEta({
          eta_arrival_at_loading_port: row.eta_vessel_arrival_at_loading_port ?? row.eta_arrival,
          eta_berthed_at_loading_port: row.eta_vessel_berthed_at_loading_port ?? row.eta_berthed,
          eta_start_loading: row.eta_vessel_start_loading ?? row.eta_loading_start,
          eta_completed_loading: row.eta_vessel_completed_loading ?? row.eta_loading_complete,
          eta_sailed_from_loading_port: row.eta_vessel_sailed_from_loading_port ?? row.eta_sailed,
          eta_arrive_at_discharge_port: row.eta_vessel_arrive_at_discharge_port ?? row.eta_discharge_arrival,
          eta_berthed_at_discharge_port: row.eta_vessel_berthed_at_discharge_port ?? row.eta_discharge_berthed,
          eta_start_discharging: row.eta_vessel_start_discharging ?? row.eta_discharge_start,
          eta_complete_discharge: row.eta_vessel_complete_discharge ?? row.eta_discharge_complete,
        });
      }
    }

    let summaryRow: Record<string, unknown> = {};
    if (includeSummary) {
      const tSa0 = performance.now();
      const summaryResult = await query(summaryCountQuery, countParams);
      timingsMs.dbSummaryAgg = performance.now() - tSa0;
      summaryRow = summaryResult.rows[0] || {};
    }

    timingsMs.total = performance.now() - tReq0;
    emitShipmentListTimings(res, timingsMs, {
      path: 'list',
      compact,
      skipSapJoin,
      effectiveListStoPaging,
      includeSummary,
      page: Number(page),
      limit: Number(limit),
      rowCount: result.rows.length,
    });

    return res.json({
      success: true,
      data: {
        shipments: result.rows,
        summary: shipmentListSummaryPayload(totalCount, summaryRow),
        pagination: {
          total: totalCount,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(totalCount / Number(limit)),
        },
      },
    });
  } catch (error: any) {
    logger.error('Get shipments error:', error);
    const errorMessage = error.message || 'Failed to fetch shipments';
    const errorDetail = error.detail || error.toString();

    const pos = typeof error.position === 'string' ? parseInt(error.position, 10) : (typeof error.position === 'number' ? error.position : null);
    const sqlSnippet =
      debugSql && typeof pos === 'number' && Number.isFinite(pos) && pos > 0
        ? debugSql.text.slice(Math.max(0, pos - 120), Math.min(debugSql.text.length, pos + 120))
        : null;

    logger.error('Error details:', {
      message: errorMessage,
      detail: errorDetail,
      code: error.code,
      position: error.position,
      sqlSnippet,
      sqlLength: debugSql?.text?.length ?? null,
      paramCount: debugSql?.params?.length ?? null,
    });
    
    return res.status(500).json({
      success: false,
      error: { 
        message: errorMessage,
        detail: process.env.NODE_ENV === 'development' ? errorDetail : undefined
      },
    });
  }
};

export const getShippingPerformance = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `WITH latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      loading_port AS (
        SELECT DISTINCT ON (vlp.shipment_id)
          vlp.shipment_id,
          vlp.eta_vessel_arrival::date AS load_eta_arrival,
          vlp.eta_vessel_berthed_at_loading_port::date AS load_eta_berthed,
          vlp.eta_loading_completed::date AS load_eta_completed
        FROM vessel_loading_ports vlp
        WHERE COALESCE(vlp.is_discharge_port, false) = false
        ORDER BY vlp.shipment_id, vlp.port_sequence NULLS LAST, vlp.id
      ),
      discharge_port AS (
        SELECT DISTINCT ON (vlp.shipment_id)
          vlp.shipment_id,
          vlp.eta_vessel_arrive_at_discharge_port::date AS discharge_eta_arrival,
          vlp.eta_vessel_berthed_at_discharge_port::date AS discharge_eta_berthed,
          vlp.eta_vessel_complete_discharge::date AS discharge_eta_completed
        FROM vessel_loading_ports vlp
        WHERE COALESCE(vlp.is_discharge_port, false) = true
        ORDER BY vlp.shipment_id, vlp.port_sequence NULLS LAST, vlp.id
      )
      SELECT
        s.id,
        s.shipment_id,
        c.contract_id AS contract_number,
        c.po_number,
        c.sto_number,
        l.contract_ext_no,
        c.contract_date::date AS contract_date,
        c.incoterm,
        c.product,
        s.vessel_name,
        s.status,
        COALESCE(NULLIF(TRIM(s.port_of_discharge), ''), 'Blank') AS plant_site,
        c.group_name,
        c.transport_mode,
        c.cargo_readiness_date::date AS cargo_readiness_date,
        COALESCE(lp.load_eta_arrival, s.eta_arrival::date) AS loading_eta_arrival,
        COALESCE(lp.load_eta_berthed, s.eta_berthed::date) AS loading_eta_berthed,
        COALESCE(lp.load_eta_completed, s.eta_loading_complete::date) AS loading_eta_completed,
        COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) AS discharge_eta_arrival,
        COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) AS discharge_eta_berthed,
        COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date) AS discharge_eta_completed,
        (COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - c.cargo_readiness_date::date)::int AS loading_delta_eta_etr_days,
        (COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - COALESCE(lp.load_eta_berthed, s.eta_berthed::date))::int AS loading_delta_eta_etb_days,
        (COALESCE(lp.load_eta_berthed, s.eta_berthed::date) - COALESCE(lp.load_eta_completed, s.eta_loading_complete::date))::int AS loading_delta_etb_etc_days,
        (COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) - COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date))::int AS discharge_delta_eta_etb_days,
        (COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) - COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date))::int AS discharge_delta_etb_etc_days,
        (
          COALESCE((COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - c.cargo_readiness_date::date), 0) +
          COALESCE((COALESCE(lp.load_eta_arrival, s.eta_arrival::date) - COALESCE(lp.load_eta_berthed, s.eta_berthed::date)), 0) +
          COALESCE((COALESCE(lp.load_eta_berthed, s.eta_berthed::date) - COALESCE(lp.load_eta_completed, s.eta_loading_complete::date)), 0) +
          COALESCE((COALESCE(dp.discharge_eta_arrival, s.eta_discharge_arrival::date) - COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date)), 0) +
          COALESCE((COALESCE(dp.discharge_eta_berthed, s.eta_discharge_berthed::date) - COALESCE(dp.discharge_eta_completed, s.eta_discharge_complete::date)), 0)
        )::int AS total_delta_days
      FROM shipments s
      INNER JOIN contracts c ON s.contract_id = c.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      LEFT JOIN loading_port lp ON lp.shipment_id = s.id
      LEFT JOIN discharge_port dp ON dp.shipment_id = s.id
      WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIX')
      ORDER BY s.created_at DESC`
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    logger.error('Get shipping performance error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipping performance data' },
    });
  }
};

export const getShipmentById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT 
        s.*,
        c.contract_id as contract_number,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        c.quantity_ordered,
        c.unit
       FROM shipments s
       LEFT JOIN contracts c ON s.contract_id = c.id
       WHERE s.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Shipment not found' },
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Get shipment by ID error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch shipment' },
    });
  }
};

export const updateShipment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    logger.info('Update shipment request:', { id, updateData });

    // shipment_id is not required for updates.
    // The route param (`id`) uniquely identifies the shipment (UUID) or the STO number to resolve to a shipment UUID.

    // Check if id is a UUID or STO number
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    let shipmentId: string;
    if (isUUID) {
      // id is a UUID, use it directly
      shipmentId = id;
    } else {
      // id is a STO number, find the shipment UUID
      const shipmentResult = await query(
        `SELECT s.id FROM shipments s 
         JOIN contracts c ON s.contract_id = c.id 
         WHERE c.sto_number = $1 LIMIT 1`,
        [id]
      );
      
      if (shipmentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { message: 'Shipment not found for STO number' },
        });
      }
      
      shipmentId = shipmentResult.rows[0].id;
    }

    // Build the update query with explicit field handling
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    // Handle each field explicitly with proper type casting
    // Skip shipment_id update to avoid duplicate key conflicts
    // The shipment_id should remain unchanged during updates

    // Status is auto-derived from ETA/ATA milestones; ignore manual status updates.

    if (updateData.vessel_code) {
      updateFields.push(`vessel_code = $${paramIndex}`);
      updateValues.push(updateData.vessel_code);
      paramIndex++;
    }

    if (updateData.vessel_loa !== undefined && updateData.vessel_loa !== null) {
      updateFields.push(`vessel_loa = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_loa);
      paramIndex++;
    }

    if (updateData.vessel_registration_year !== undefined && updateData.vessel_registration_year !== null) {
      updateFields.push(`vessel_registration_year = $${paramIndex}::int`);
      updateValues.push(updateData.vessel_registration_year);
      paramIndex++;
    }

    if (updateData.vessel_name) {
      updateFields.push(`vessel_name = $${paramIndex}`);
      updateValues.push(updateData.vessel_name);
      paramIndex++;
    }

    if (updateData.voyage_no) {
      updateFields.push(`voyage_no = $${paramIndex}`);
      updateValues.push(updateData.voyage_no);
      paramIndex++;
    }

    if (updateData.vessel_owner) {
      updateFields.push(`vessel_owner = $${paramIndex}`);
      updateValues.push(updateData.vessel_owner);
      paramIndex++;
    }

    if (updateData.vessel_draft !== undefined && updateData.vessel_draft !== null) {
      updateFields.push(`vessel_draft = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_draft);
      paramIndex++;
    }

    if (updateData.vessel_capacity !== undefined && updateData.vessel_capacity !== null) {
      updateFields.push(`vessel_capacity = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_capacity);
      paramIndex++;
    }

    if (updateData.vessel_hull_type) {
      updateFields.push(`vessel_hull_type = $${paramIndex}`);
      updateValues.push(updateData.vessel_hull_type);
      paramIndex++;
    }

    if (updateData.charter_type) {
      updateFields.push(`charter_type = $${paramIndex}`);
      updateValues.push(updateData.charter_type);
      paramIndex++;
    }

    if (updateData.port_of_loading) {
      updateFields.push(`port_of_loading = $${paramIndex}`);
      updateValues.push(updateData.port_of_loading);
      paramIndex++;
    }

    if (updateData.port_of_discharge) {
      updateFields.push(`port_of_discharge = $${paramIndex}`);
      updateValues.push(updateData.port_of_discharge);
      paramIndex++;
    }

    if (updateData.shipment_date) {
      updateFields.push(`shipment_date = $${paramIndex}::date`);
      updateValues.push(updateData.shipment_date);
      paramIndex++;
    }

    if (updateData.arrival_date) {
      updateFields.push(`arrival_date = $${paramIndex}::date`);
      updateValues.push(updateData.arrival_date);
      paramIndex++;
    }

    if (updateData.quantity_shipped !== undefined && updateData.quantity_shipped !== null) {
      updateFields.push(`quantity_shipped = $${paramIndex}::numeric`);
      updateValues.push(updateData.quantity_shipped);
      paramIndex++;
    }

    if (updateData.quantity_delivered !== undefined && updateData.quantity_delivered !== null) {
      updateFields.push(`quantity_delivered = $${paramIndex}::numeric`);
      updateValues.push(updateData.quantity_delivered);
      paramIndex++;
    }

    if (updateData.bl_quantity !== undefined && updateData.bl_quantity !== null) {
      updateFields.push(`bl_quantity = $${paramIndex}::numeric`);
      updateValues.push(updateData.bl_quantity);
      paramIndex++;
    }

    if (updateData.actual_vessel_qty_receive !== undefined && updateData.actual_vessel_qty_receive !== null) {
      updateFields.push(`actual_vessel_qty_receive = $${paramIndex}::numeric`);
      updateValues.push(updateData.actual_vessel_qty_receive);
      paramIndex++;
    }

    if (updateData.difference_final_qty_vs_bl_qty !== undefined && updateData.difference_final_qty_vs_bl_qty !== null) {
      updateFields.push(`difference_final_qty_vs_bl_qty = $${paramIndex}::numeric`);
      updateValues.push(updateData.difference_final_qty_vs_bl_qty);
      paramIndex++;
    }

    if (updateData.gain_loss_percentage !== undefined && updateData.gain_loss_percentage !== null) {
      updateFields.push(`gain_loss_percentage = $${paramIndex}::numeric`);
      updateValues.push(updateData.gain_loss_percentage);
      paramIndex++;
    }

    if (updateData.gain_loss_amount !== undefined && updateData.gain_loss_amount !== null) {
      updateFields.push(`gain_loss_amount = $${paramIndex}::numeric`);
      updateValues.push(updateData.gain_loss_amount);
      paramIndex++;
    }

    if (updateData.estimated_km !== undefined && updateData.estimated_km !== null) {
      updateFields.push(`estimated_km = $${paramIndex}::numeric`);
      updateValues.push(updateData.estimated_km);
      paramIndex++;
    }

    if (updateData.estimated_nautical_miles !== undefined && updateData.estimated_nautical_miles !== null) {
      updateFields.push(`estimated_nautical_miles = $${paramIndex}::numeric`);
      updateValues.push(updateData.estimated_nautical_miles);
      paramIndex++;
    }

    if (updateData.vessel_oa_budget !== undefined && updateData.vessel_oa_budget !== null) {
      updateFields.push(`vessel_oa_budget = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_oa_budget);
      paramIndex++;
    }

    if (updateData.vessel_oa_actual !== undefined && updateData.vessel_oa_actual !== null) {
      updateFields.push(`vessel_oa_actual = $${paramIndex}::numeric`);
      updateValues.push(updateData.vessel_oa_actual);
      paramIndex++;
    }

    if (updateData.average_vessel_speed !== undefined && updateData.average_vessel_speed !== null) {
      updateFields.push(`average_vessel_speed = $${paramIndex}::numeric`);
      updateValues.push(updateData.average_vessel_speed);
      paramIndex++;
    }

    if (updateData.sla_days !== undefined && updateData.sla_days !== null) {
      updateFields.push(`sla_days = $${paramIndex}::numeric`);
      updateValues.push(updateData.sla_days);
      paramIndex++;
    }

    if (updateData.is_delayed !== undefined && updateData.is_delayed !== null) {
      updateFields.push(`is_delayed = $${paramIndex}::boolean`);
      updateValues.push(updateData.is_delayed);
      paramIndex++;
    }

    if (updateData.sap_delivery_id) {
      updateFields.push(`sap_delivery_id = $${paramIndex}`);
      updateValues.push(updateData.sap_delivery_id);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No valid fields to update' },
      });
    }

    // Add updated_at timestamp
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(shipmentId);

    const queryText = `
      UPDATE shipments 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    logger.info('Executing query:', { queryText, updateValues, paramIndex });
    
    const result = await query(queryText, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Shipment not found' },
      });
    }

    // Auto-derive status after milestone updates.
    const updated = result.rows[0] as any;
    const ataDerived = deriveShipmentStatusFromAta({
      ata_arrival_at_loading_port: updated.ata_arrival,
      ata_berthed_at_loading_port: updated.ata_berthed,
      ata_start_loading: updated.ata_loading_start,
      ata_completed_loading: updated.ata_loading_complete,
      ata_sailed_from_loading_port: updated.ata_sailed,
      ata_arrive_at_discharge_port: updated.ata_discharge_arrival,
      ata_berthed_at_discharge_port: updated.ata_discharge_berthed,
      ata_start_discharging: updated.ata_discharge_start,
      ata_complete_discharge: updated.ata_discharge_complete,
    });
    const autoStatus =
      ataDerived === 'COMPLETED'
        ? 'COMPLETED'
        : deriveShipmentStatusFromEta({
            eta_arrival_at_loading_port: updated.eta_arrival,
            eta_berthed_at_loading_port: updated.eta_berthed,
            eta_start_loading: updated.eta_loading_start,
            eta_completed_loading: updated.eta_loading_complete,
            eta_sailed_from_loading_port: updated.eta_sailed,
            eta_arrive_at_discharge_port: updated.eta_discharge_arrival,
            eta_berthed_at_discharge_port: updated.eta_discharge_berthed,
            eta_start_discharging: updated.eta_discharge_start,
            eta_complete_discharge: updated.eta_discharge_complete,
          });

    if (String(updated.status || '').trim().toUpperCase() !== autoStatus) {
      const sRes = await query(
        `UPDATE shipments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING status`,
        [autoStatus, shipmentId]
      );
      updated.status = sRes.rows?.[0]?.status ?? autoStatus;
    } else {
      updated.status = autoStatus;
    }

    logger.info('Shipment updated:', { id, updatedFields: updateFields.length, autoStatus });

    return res.json({
      success: true,
      data: updated,
      message: 'Shipment updated successfully',
    });
  } catch (error) {
    logger.error('Update shipment error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to update shipment' },
    });
  }
};

// Get vessel loading ports for a shipment or STO
export const getVesselLoadingPorts = async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId } = req.params;
    logger.info('Getting vessel loading ports for:', { shipmentId });

    // Check if shipmentId is a UUID (individual shipment) or STO number (aggregated)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shipmentId);
    logger.info('Is UUID:', isUUID);

    let portsResult;
    let shipmentInfoResult;
    
    if (isUUID) {
      // Get loading ports for a specific shipment
      portsResult = await query(
        `SELECT 
          vlp.id,
          vlp.shipment_id,
          vlp.port_name,
          vlp.port_sequence,
          vlp.quantity_at_loading_port,
          vlp.eta_vessel_arrival,
          vlp.ata_vessel_arrival,
          vlp.eta_vessel_berthed,
          vlp.ata_vessel_berthed,
          vlp.eta_loading_start,
          vlp.ata_loading_start,
          vlp.eta_loading_completed,
          vlp.ata_loading_completed,
          vlp.eta_vessel_sailed,
          vlp.ata_vessel_sailed,
          vlp.eta_vessel_berthed_at_loading_port,
          vlp.eta_vessel_arrive_at_discharge_port,
          vlp.eta_vessel_berthed_at_discharge_port,
          vlp.eta_vessel_start_discharging,
          vlp.eta_vessel_complete_discharge,
          vlp.loading_rate,
          vlp.quality_ffa,
          vlp.quality_mi,
          vlp.quality_dobi,
          vlp.quality_red,
          vlp.quality_ds,
          vlp.quality_stone,
          vlp.is_discharge_port,
          vlp.created_at,
          vlp.updated_at,
          c.contract_id as contract_number
         FROM vessel_loading_ports vlp
         LEFT JOIN shipments s ON vlp.shipment_id = s.id
         LEFT JOIN contracts c ON s.contract_id = c.id
         WHERE vlp.shipment_id = $1 
         ORDER BY vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
        [shipmentId]
      );

      // Backfill: if shipment has port names but no vessel_loading_ports rows, create one loading + one discharge row from shipments
      if (portsResult.rows.length === 0) {
        const shipRow = await query(
          `SELECT id, port_of_loading, port_of_discharge, actual_vessel_qty_receive
           FROM shipments WHERE id = $1`,
          [shipmentId]
        );
        if (shipRow.rows.length > 0) {
          const s = shipRow.rows[0];
          const pol = (s.port_of_loading && String(s.port_of_loading).trim()) || null;
          const pod = (s.port_of_discharge && String(s.port_of_discharge).trim()) || null;
          if (pol) {
            await query(
              `INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence, quantity_at_loading_port, is_discharge_port)
               VALUES ($1, $2, 1, $3::numeric, false)`,
              [shipmentId, pol, s.actual_vessel_qty_receive ?? null]
            );
          }
          if (pod) {
            await query(
              `INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence, quantity_at_loading_port, is_discharge_port)
               VALUES ($1, $2, 999, 0, true)`,
              [shipmentId, pod]
            );
          }
          if (pol || pod) {
            portsResult = await query(
              `SELECT vlp.id, vlp.shipment_id, vlp.port_name, vlp.port_sequence, vlp.quantity_at_loading_port,
                vlp.eta_vessel_arrival, vlp.ata_vessel_arrival, vlp.eta_vessel_berthed, vlp.ata_vessel_berthed,
                vlp.eta_loading_start, vlp.ata_loading_start, vlp.eta_loading_completed, vlp.ata_loading_completed,
                vlp.eta_vessel_sailed, vlp.ata_vessel_sailed,
                vlp.eta_vessel_berthed_at_loading_port, vlp.eta_vessel_arrive_at_discharge_port,
                vlp.eta_vessel_berthed_at_discharge_port, vlp.eta_vessel_start_discharging, vlp.eta_vessel_complete_discharge,
                vlp.loading_rate, vlp.quality_ffa, vlp.quality_mi, vlp.quality_dobi, vlp.quality_red, vlp.quality_ds, vlp.quality_stone,
                vlp.is_discharge_port, vlp.created_at, vlp.updated_at,
                c.contract_id as contract_number
               FROM vessel_loading_ports vlp
               LEFT JOIN shipments sh ON vlp.shipment_id = sh.id
               LEFT JOIN contracts c ON sh.contract_id = c.id
               WHERE vlp.shipment_id = $1
               ORDER BY vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
              [shipmentId]
            );
          }
        }
      }

      // Get shipment-level information
      // Also pull ATA dates from first loading port if not in shipments table
      // Include ETA dates from loading ports and calculate loading rate
      shipmentInfoResult = await query(
        `SELECT 
          s.quantity_delivered,
          s.actual_vessel_qty_receive,
          s.vessel_oa_actual,
          s.vessel_oa_budget,
          s.bl_quantity,
          s.port_of_loading as vessel_loading_port_1,
          s.port_of_discharge as vessel_discharge_port_1,
          c.contract_id as contract_number,
          COALESCE(s.ata_arrival, vlp1.ata_vessel_arrival::date) as ata_vessel_arrival_at_loading_port,
          COALESCE(s.ata_berthed, vlp1.ata_vessel_berthed::date) as ata_vessel_berthed_at_loading_port,
          COALESCE(s.ata_loading_start, vlp1.ata_loading_start::date) as ata_vessel_start_loading,
          COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed::date) as ata_vessel_completed_loading,
          COALESCE(s.ata_sailed, vlp1.ata_vessel_sailed::date) as ata_vessel_sailed_from_loading_port,
          COALESCE(s.ata_discharge_arrival, vlpd.ata_vessel_arrival::date) as ata_vessel_arrive_at_discharge_port,
          COALESCE(s.ata_discharge_berthed, vlpd.ata_vessel_berthed::date) as ata_vessel_berthed_at_discharge_port,
          COALESCE(s.ata_discharge_start, vlpd.ata_loading_start::date) as ata_vessel_start_discharging,
          COALESCE(s.ata_discharge_complete, vlpd.ata_loading_completed::date) as ata_vessel_complete_discharge,
          -- ETA fields: prefer vessel_loading_ports, fallback to shipments so UI shows data from either table
          COALESCE(vlp1.eta_vessel_arrival::date, s.eta_arrival) as eta_vessel_arrival_at_loading_port,
          COALESCE(vlp1.eta_vessel_berthed_at_loading_port::date, s.eta_berthed) as eta_vessel_berthed_at_loading_port,
          COALESCE(vlp1.eta_loading_start::date, s.eta_loading_start) as eta_vessel_start_loading,
          COALESCE(vlp1.eta_loading_completed::date, s.eta_loading_complete) as eta_vessel_completed_loading,
          COALESCE(vlp1.eta_vessel_sailed::date, s.eta_sailed) as eta_vessel_sailed_from_loading_port,
          COALESCE(vlpd.eta_vessel_arrive_at_discharge_port::date, s.eta_discharge_arrival) as eta_vessel_arrive_at_discharge_port,
          COALESCE(vlpd.eta_vessel_berthed_at_discharge_port::date, s.eta_discharge_berthed) as eta_vessel_berthed_at_discharge_port,
          COALESCE(vlpd.eta_vessel_start_discharging::date, s.eta_discharge_start) as eta_vessel_start_discharging,
          COALESCE(vlpd.eta_vessel_complete_discharge::date, s.eta_discharge_complete) as eta_vessel_complete_discharge,
          -- Loading rate (kg/day): Quantity Receive / (ATA Completed Loading − ATA Start Loading) in days
          CASE 
            WHEN s.actual_vessel_qty_receive > 0 
              AND COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed) IS NOT NULL
              AND COALESCE(s.ata_loading_start, vlp1.ata_loading_start) IS NOT NULL
            THEN s.actual_vessel_qty_receive / NULLIF(
              EXTRACT(EPOCH FROM (COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed) - COALESCE(s.ata_loading_start, vlp1.ata_loading_start))) / 86400.0,
              0
            )
            ELSE NULL
          END as loading_rate_kg_per_day,
          -- Quality fields from first loading port
          vlp1.quality_ffa as quality_at_loading_loc_1_ffa,
          vlp1.quality_mi as quality_at_loading_loc_1_mi,
          vlp1.quality_dobi as quality_at_loading_loc_1_dobi,
          vlp1.quality_red as quality_at_loading_loc_1_red,
          vlp1.quality_ds as quality_at_loading_loc_1_ds,
          vlp1.quality_stone as quality_at_loading_loc_1_stone,
          -- Quality fields from discharge port
          vlpd.quality_ffa as quality_at_discharge_loc_1_ffa,
          vlpd.quality_mi as quality_at_discharge_loc_1_mi,
          vlpd.quality_dobi as quality_at_discharge_loc_1_dobi,
          vlpd.quality_red as quality_at_discharge_loc_1_red,
          vlpd.quality_ds as quality_at_discharge_loc_1_ds,
          vlpd.quality_stone as quality_at_discharge_loc_1_stone
         FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         LEFT JOIN vessel_loading_ports vlp1 ON vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false
         LEFT JOIN vessel_loading_ports vlpd ON vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true
         WHERE s.id = $1
         LIMIT 1`,
        [shipmentId]
      );
    } else {
      // Get loading ports for all shipments under this STO
      portsResult = await query(
        `SELECT 
          vlp.id,
          vlp.shipment_id,
          vlp.port_name,
          vlp.port_sequence,
          vlp.quantity_at_loading_port,
          vlp.eta_vessel_arrival,
          vlp.ata_vessel_arrival,
          vlp.eta_vessel_berthed,
          vlp.ata_vessel_berthed,
          vlp.eta_loading_start,
          vlp.ata_loading_start,
          vlp.eta_loading_completed,
          vlp.ata_loading_completed,
          vlp.eta_vessel_sailed,
          vlp.ata_vessel_sailed,
          vlp.eta_vessel_berthed_at_loading_port,
          vlp.eta_vessel_arrive_at_discharge_port,
          vlp.eta_vessel_berthed_at_discharge_port,
          vlp.eta_vessel_start_discharging,
          vlp.eta_vessel_complete_discharge,
          vlp.loading_rate,
          vlp.quality_ffa,
          vlp.quality_mi,
          vlp.quality_dobi,
          vlp.quality_red,
          vlp.quality_ds,
          vlp.quality_stone,
          vlp.is_discharge_port,
          vlp.created_at,
          vlp.updated_at,
          c.contract_id as contract_number
         FROM vessel_loading_ports vlp
         LEFT JOIN shipments s ON vlp.shipment_id = s.id
         LEFT JOIN contracts c ON s.contract_id = c.id
         WHERE c.sto_number = $1 OR s.shipment_id = $1
         ORDER BY c.contract_id, vlp.port_sequence ASC, vlp.is_discharge_port ASC`,
        [shipmentId]
      );
      
      // Get shipment-level information (aggregated by STO)
      // Also pull ATA dates from first loading port if not in shipments table
      // Include ETA dates from loading ports and calculate loading rate
      shipmentInfoResult = await query(
        `SELECT 
          MAX(s.quantity_delivered) as quantity_delivered,
          MAX(s.actual_vessel_qty_receive) as actual_vessel_qty_receive,
          MAX(s.vessel_oa_actual) as vessel_oa_actual,
          MAX(s.vessel_oa_budget) as vessel_oa_budget,
          MAX(s.bl_quantity) as bl_quantity,
          MAX(s.port_of_loading) as vessel_loading_port_1,
          MAX(s.port_of_discharge) as vessel_discharge_port_1,
          MAX(c.contract_id) as contract_number,
          MAX(COALESCE(s.ata_arrival, vlp1.ata_vessel_arrival::date)) as ata_vessel_arrival_at_loading_port,
          MAX(COALESCE(s.ata_berthed, vlp1.ata_vessel_berthed::date)) as ata_vessel_berthed_at_loading_port,
          MAX(COALESCE(s.ata_loading_start, vlp1.ata_loading_start::date)) as ata_vessel_start_loading,
          MAX(COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed::date)) as ata_vessel_completed_loading,
          MAX(COALESCE(s.ata_sailed, vlp1.ata_vessel_sailed::date)) as ata_vessel_sailed_from_loading_port,
          MAX(COALESCE(s.ata_discharge_arrival, vlpd.ata_vessel_arrival::date)) as ata_vessel_arrive_at_discharge_port,
          MAX(COALESCE(s.ata_discharge_berthed, vlpd.ata_vessel_berthed::date)) as ata_vessel_berthed_at_discharge_port,
          MAX(COALESCE(s.ata_discharge_start, vlpd.ata_loading_start::date)) as ata_vessel_start_discharging,
          MAX(COALESCE(s.ata_discharge_complete, vlpd.ata_loading_completed::date)) as ata_vessel_complete_discharge,
          -- ETA fields from loading ports
          MAX(vlp1.eta_vessel_arrival::date) as eta_vessel_arrival_at_loading_port,
          MAX(vlp1.eta_vessel_berthed_at_loading_port::date) as eta_vessel_berthed_at_loading_port,
          MAX(vlp1.eta_loading_start::date) as eta_vessel_start_loading,
          MAX(vlp1.eta_loading_completed::date) as eta_vessel_completed_loading,
          MAX(vlp1.eta_vessel_sailed::date) as eta_vessel_sailed_from_loading_port,
          MAX(vlpd.eta_vessel_arrive_at_discharge_port::date) as eta_vessel_arrive_at_discharge_port,
          MAX(vlpd.eta_vessel_berthed_at_discharge_port::date) as eta_vessel_berthed_at_discharge_port,
          MAX(vlpd.eta_vessel_start_discharging::date) as eta_vessel_start_discharging,
          MAX(vlpd.eta_vessel_complete_discharge::date) as eta_vessel_complete_discharge,
          -- Loading rate (kg/day): Quantity Receive / (ATA Completed Loading − ATA Start Loading) in days
          CASE 
            WHEN MAX(s.actual_vessel_qty_receive) > 0 
              AND MAX(COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed)) IS NOT NULL
              AND MAX(COALESCE(s.ata_loading_start, vlp1.ata_loading_start)) IS NOT NULL
            THEN MAX(s.actual_vessel_qty_receive) / NULLIF(
              EXTRACT(EPOCH FROM (MAX(COALESCE(s.ata_loading_complete, vlp1.ata_loading_completed)) - MAX(COALESCE(s.ata_loading_start, vlp1.ata_loading_start)))) / 86400.0,
              0
            )
            ELSE NULL
          END as loading_rate_kg_per_day,
          -- Quality fields from first loading port
          MAX(vlp1.quality_ffa) as quality_at_loading_loc_1_ffa,
          MAX(vlp1.quality_mi) as quality_at_loading_loc_1_mi,
          MAX(vlp1.quality_dobi) as quality_at_loading_loc_1_dobi,
          MAX(vlp1.quality_red) as quality_at_loading_loc_1_red,
          MAX(vlp1.quality_ds) as quality_at_loading_loc_1_ds,
          MAX(vlp1.quality_stone) as quality_at_loading_loc_1_stone,
          -- Quality fields from discharge port
          MAX(vlpd.quality_ffa) as quality_at_discharge_loc_1_ffa,
          MAX(vlpd.quality_mi) as quality_at_discharge_loc_1_mi,
          MAX(vlpd.quality_dobi) as quality_at_discharge_loc_1_dobi,
          MAX(vlpd.quality_red) as quality_at_discharge_loc_1_red,
          MAX(vlpd.quality_ds) as quality_at_discharge_loc_1_ds,
          MAX(vlpd.quality_stone) as quality_at_discharge_loc_1_stone
         FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         LEFT JOIN vessel_loading_ports vlp1 ON vlp1.shipment_id = s.id AND vlp1.port_sequence = 1 AND vlp1.is_discharge_port = false
         LEFT JOIN vessel_loading_ports vlpd ON vlpd.shipment_id = s.id AND vlpd.is_discharge_port = true
         WHERE c.sto_number = $1 OR s.shipment_id = $1
         GROUP BY COALESCE(c.sto_number, s.shipment_id)`,
        [shipmentId]
      );
    }

    let shipmentInfo = shipmentInfoResult.rows[0] || null;

    // Fallback: if all ATA fields are null but SAP processed data has values,
    // hydrate shipmentInfo ATA dates directly from sap_processed_data.shipment.
    if (shipmentInfo && shipmentInfo.contract_number) {
      const ataKeys = [
        'ata_vessel_arrival_at_loading_port',
        'ata_vessel_berthed_at_loading_port',
        'ata_vessel_start_loading',
        'ata_vessel_completed_loading',
        'ata_vessel_sailed_from_loading_port',
        'ata_vessel_arrive_at_discharge_port',
        'ata_vessel_berthed_at_discharge_port',
        'ata_vessel_start_discharging',
        'ata_vessel_complete_discharge'
      ] as const;

      const allAtaNull = ataKeys.every(
        (k) => shipmentInfo[k as keyof typeof shipmentInfo] == null
      );

      if (allAtaNull) {
        const sapResult = await query(
          `SELECT data
             FROM sap_processed_data
            WHERE contract_number = $1
            ORDER BY created_at DESC NULLS LAST
            LIMIT 1`,
          [shipmentInfo.contract_number]
        );

        if (sapResult.rows.length > 0) {
          const data: any = sapResult.rows[0].data || {};
          const shp: any = data.shipment || {};

          const normalizeDate = (value: any): string | null => {
            if (value === null || value === undefined || value === '') return null;
            if (value instanceof Date && !isNaN(value.getTime())) {
              return value.toISOString().split('T')[0];
            }
            if (typeof value === 'number') {
              // Interpret as Excel serial date (days since 1899-12-30)
              const excelEpoch = Date.UTC(1899, 11, 30);
              const ms = excelEpoch + value * 86400000;
              const d = new Date(ms);
              if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
              return null;
            }
            if (typeof value === 'string') {
              const d = new Date(value);
              if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
            }
            return null;
          };

          const mapping: Record<string, string> = {
            ata_vessel_arrival_at_loading_port: 'ata_vessel_arrival_at_loading_port_1',
            ata_vessel_berthed_at_loading_port: 'ata_vessel_berthed_at_loading_port_1',
            ata_vessel_start_loading: 'ata_vessel_start_loading',
            ata_vessel_completed_loading: 'ata_vessel_completed_loading',
            ata_vessel_sailed_from_loading_port: 'ata_vessel_sailed_from_loading_port',
            ata_vessel_arrive_at_discharge_port: 'ata_vessel_arrival_at_discharge_port',
            ata_vessel_berthed_at_discharge_port: 'ata_vessel_berthed_at_discharge_port',
            ata_vessel_start_discharging: 'ata_vessel_start_discharging',
            ata_vessel_complete_discharge: 'ata_vessel_completed_discharge'
          };

          for (const [uiKey, sapKey] of Object.entries(mapping)) {
            const current = (shipmentInfo as any)[uiKey];
            if (current == null && shp && sapKey in shp) {
              const normalized = normalizeDate(shp[sapKey]);
              if (normalized) {
                (shipmentInfo as any)[uiKey] = normalized;
              }
            }
          }
        }
      }
    }
    logger.info('ShipmentInfo result:', { 
      hasData: !!shipmentInfo,
      rowCount: shipmentInfoResult.rows.length,
      sample: shipmentInfo ? {
        quantity_delivered: shipmentInfo.quantity_delivered,
        actual_vessel_qty_receive: shipmentInfo.actual_vessel_qty_receive
      } : null
    });

    return res.json({
      success: true,
      data: {
        ports: portsResult.rows,
        shipmentInfo: shipmentInfo,
      },
    });
  } catch (error) {
    logger.error('Get vessel loading ports error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch vessel loading ports' },
    });
  }
};

// Add or update vessel loading port
export const upsertVesselLoadingPort = async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId, portId } = req.params;
    
    // Check if shipmentId is a UUID or STO number/shipment_id, and convert to actual shipment UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shipmentId);
    let actualShipmentId: string;
    
    if (isUUID) {
      actualShipmentId = shipmentId;
    } else {
      // Find the shipment UUID by STO number or shipment_id
      const shipmentResult = await query(
        `SELECT s.id FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         WHERE c.sto_number = $1 OR s.shipment_id = $1
         LIMIT 1`,
        [shipmentId]
      );
      
      if (shipmentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { message: 'Shipment not found' },
        });
      }
      
      actualShipmentId = shipmentResult.rows[0].id;
    }
    
    const {
      id: bodyId,
      port_name,
      port_sequence,
      quantity_at_loading_port,
      quality_ffa,
      quality_mi,
      quality_dobi,
      quality_red,
      quality_ds,
      quality_stone,
      eta_vessel_arrival,
      ata_vessel_arrival,
      eta_vessel_berthed,
      ata_vessel_berthed,
      eta_loading_start,
      ata_loading_start,
      eta_loading_completed,
      ata_loading_completed,
      eta_vessel_sailed,
      ata_vessel_sailed,
      eta_vessel_berthed_at_loading_port,
      eta_vessel_arrive_at_discharge_port,
      eta_vessel_berthed_at_discharge_port,
      eta_vessel_start_discharging,
      eta_vessel_complete_discharge
    } = req.body;

    // Normalize date-like fields: empty string or invalid -> null so DB accepts them
    const toDateOrNull = (v: unknown): string | null => {
      if (v == null || v === '') return null;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v;
      if (typeof v === 'string') {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return v;
      }
      return null;
    };
    const eta_vessel_arrival_n = toDateOrNull(eta_vessel_arrival);
    const ata_vessel_arrival_n = toDateOrNull(ata_vessel_arrival);
    const eta_vessel_berthed_n = toDateOrNull(eta_vessel_berthed);
    const ata_vessel_berthed_n = toDateOrNull(ata_vessel_berthed);
    const eta_loading_start_n = toDateOrNull(eta_loading_start);
    const ata_loading_start_n = toDateOrNull(ata_loading_start);
    const eta_loading_completed_n = toDateOrNull(eta_loading_completed);
    const ata_loading_completed_n = toDateOrNull(ata_loading_completed);
    const eta_vessel_sailed_n = toDateOrNull(eta_vessel_sailed);
    const ata_vessel_sailed_n = toDateOrNull(ata_vessel_sailed);
    const eta_vessel_berthed_at_loading_port_n = toDateOrNull(eta_vessel_berthed_at_loading_port);
    const eta_vessel_arrive_at_discharge_port_n = toDateOrNull(eta_vessel_arrive_at_discharge_port);
    const eta_vessel_berthed_at_discharge_port_n = toDateOrNull(eta_vessel_berthed_at_discharge_port);
    const eta_vessel_start_discharging_n = toDateOrNull(eta_vessel_start_discharging);
    const eta_vessel_complete_discharge_n = toDateOrNull(eta_vessel_complete_discharge);

    const toNumberOrNull = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };
    const quality_ffa_n = toNumberOrNull(quality_ffa);
    const quality_mi_n = toNumberOrNull(quality_mi);
    const quality_dobi_n = toNumberOrNull(quality_dobi);
    const quality_red_n = toNumberOrNull(quality_red);
    const quality_ds_n = toNumberOrNull(quality_ds);
    const quality_stone_n = toNumberOrNull(quality_stone);

    // Prefer explicit id from body, then fallback to route param (for PUT /:shipmentId/loading-ports/:portId)
    const id = bodyId || portId;

    // Loading rate (kg/day): quantity_at_loading_port / (ATA completed − ATA start) in days
    let loading_rate = null;
    if (ata_loading_completed_n && ata_loading_start_n && quantity_at_loading_port) {
      const startTime = new Date(ata_loading_start_n);
      const endTime = new Date(ata_loading_completed_n);
      const days = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 0) {
        loading_rate = parseFloat(String(quantity_at_loading_port)) / days;
      }
    }

    if (id) {
      // Update existing loading port
      const result = await query(
        `UPDATE vessel_loading_ports 
         SET 
           port_name = $2,
           port_sequence = $3,
           quantity_at_loading_port = $4,
           quality_ffa = $5,
           quality_mi = $6,
           quality_dobi = $7,
           quality_red = $8,
           quality_ds = $9,
           quality_stone = $10,
           eta_vessel_arrival = $11,
           ata_vessel_arrival = $12,
           eta_vessel_berthed = $13,
           ata_vessel_berthed = $14,
           eta_loading_start = $15,
           ata_loading_start = $16,
           eta_loading_completed = $17,
           ata_loading_completed = $18,
           eta_vessel_sailed = $19,
           ata_vessel_sailed = $20,
           eta_vessel_berthed_at_loading_port = $21,
           eta_vessel_arrive_at_discharge_port = $22,
           eta_vessel_berthed_at_discharge_port = $23,
           eta_vessel_start_discharging = $24,
           eta_vessel_complete_discharge = $25,
           loading_rate = $26,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND shipment_id = $27
         RETURNING *`,
        [
          id, port_name, port_sequence, quantity_at_loading_port,
          quality_ffa_n,
          quality_mi_n,
          quality_dobi_n,
          quality_red_n,
          quality_ds_n,
          quality_stone_n,
          eta_vessel_arrival_n,
          ata_vessel_arrival_n,
          eta_vessel_berthed_n,
          ata_vessel_berthed_n,
          eta_loading_start_n,
          ata_loading_start_n,
          eta_loading_completed_n,
          ata_loading_completed_n,
          eta_vessel_sailed_n,
          ata_vessel_sailed_n,
          eta_vessel_berthed_at_loading_port_n,
          eta_vessel_arrive_at_discharge_port_n,
          eta_vessel_berthed_at_discharge_port_n,
          eta_vessel_start_discharging_n,
          eta_vessel_complete_discharge_n,
          loading_rate,
          actualShipmentId,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { message: 'Vessel loading port not found' },
        });
      }

      const updated = result.rows[0];
      if (updated.port_sequence === 1 && !updated.is_discharge_port) {
        await query(
          `UPDATE shipments SET
            eta_arrival = $2, eta_berthed = $3, eta_loading_start = $4, eta_loading_complete = $5, eta_sailed = $6,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [actualShipmentId, eta_vessel_arrival_n, eta_vessel_berthed_at_loading_port_n, eta_loading_start_n, eta_loading_completed_n, eta_vessel_sailed_n]
        );
      }

      return res.json({
        success: true,
        data: result.rows[0],
        message: 'Vessel loading port updated successfully',
      });
    } else {
      // Create new loading port
      const result = await query(
        `INSERT INTO vessel_loading_ports 
         (shipment_id, port_name, port_sequence, quantity_at_loading_port,
          quality_ffa, quality_mi, quality_dobi, quality_red, quality_ds, quality_stone,
          eta_vessel_arrival, ata_vessel_arrival, eta_vessel_berthed, ata_vessel_berthed,
          eta_loading_start, ata_loading_start, eta_loading_completed, ata_loading_completed,
          eta_vessel_sailed, ata_vessel_sailed,
          eta_vessel_berthed_at_loading_port,
          eta_vessel_arrive_at_discharge_port,
          eta_vessel_berthed_at_discharge_port,
          eta_vessel_start_discharging,
          eta_vessel_complete_discharge,
          loading_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
         RETURNING *`,
        [
          actualShipmentId, port_name, port_sequence, quantity_at_loading_port,
          quality_ffa_n,
          quality_mi_n,
          quality_dobi_n,
          quality_red_n,
          quality_ds_n,
          quality_stone_n,
          eta_vessel_arrival_n,
          ata_vessel_arrival_n,
          eta_vessel_berthed_n,
          ata_vessel_berthed_n,
          eta_loading_start_n,
          ata_loading_start_n,
          eta_loading_completed_n,
          ata_loading_completed_n,
          eta_vessel_sailed_n,
          ata_vessel_sailed_n,
          eta_vessel_berthed_at_loading_port_n,
          eta_vessel_arrive_at_discharge_port_n,
          eta_vessel_berthed_at_discharge_port_n,
          eta_vessel_start_discharging_n,
          eta_vessel_complete_discharge_n,
          loading_rate,
        ]
      );

      const inserted = result.rows[0];
      if (inserted.port_sequence === 1 && !inserted.is_discharge_port) {
        await query(
          `UPDATE shipments SET
            eta_arrival = $2, eta_berthed = $3, eta_loading_start = $4, eta_loading_complete = $5, eta_sailed = $6,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [actualShipmentId, eta_vessel_arrival_n, eta_vessel_berthed_at_loading_port_n, eta_loading_start_n, eta_loading_completed_n, eta_vessel_sailed_n]
        );
      }

      return res.json({
        success: true,
        data: result.rows[0],
        message: 'Vessel loading port created successfully',
      });
    }
  } catch (error) {
    logger.error('Upsert vessel loading port error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to save vessel loading port' },
    });
  }
};

// Delete vessel loading port
export const deleteVesselLoadingPort = async (req: AuthRequest, res: Response) => {
  try {
    const { shipmentId, portId } = req.params;

    const result = await query(
      'DELETE FROM vessel_loading_ports WHERE id = $1 AND shipment_id = $2 RETURNING *',
      [portId, shipmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Vessel loading port not found' },
      });
    }

    return res.json({
      success: true,
      message: 'Vessel loading port deleted successfully',
    });
  } catch (error) {
    logger.error('Delete vessel loading port error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to delete vessel loading port' },
    });
  }
};

// =========================
// Daily Planning Deliverables (SEA Shipments)
// =========================

const MAX_BULK_SHIPMENT_PLANNING_ROWS = 10000;

function normalizePlanningHeader(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findPlanningColumnIndex(headers: unknown[], candidates: string[]): number {
  const norm = headers.map(normalizePlanningHeader);
  const candNorm = candidates.map(normalizePlanningHeader);
  for (let i = 0; i < norm.length; i++) {
    const h = norm[i].replace(/\s/g, '_');
    for (const c of candNorm) {
      const cc = c.replace(/\s/g, '_');
      if (norm[i] === c || h === cc) return i;
    }
  }
  return -1;
}

export const downloadShipmentDailyPlanningDeliverablesTemplate = async (_req: AuthRequest, res: Response) => {
  const header = 'contract_ext_no,date,quantity_delivered';
  const example = 'EXT-12345,15/04/2026,1000';
  const bom = '\ufeff';
  const body = `${bom}${header}\n${example}\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="shipment_daily_planning_deliverables_template.csv"');
  return res.status(200).send(body);
};

export const getShipmentDailyDeliverablesCalendar = async (req: AuthRequest, res: Response) => {
  try {
    const from = String((req.query as any).from || '').slice(0, 10);
    const to = String((req.query as any).to || '').slice(0, 10);
    if (!from || !to) {
      return res.status(400).json({ success: false, error: { message: 'from and to are required (YYYY-MM-DD)' } });
    }

    const result = await query(
      `
      WITH latest_spd AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No') AS contract_ext_no,
          spd.data AS data
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      vlp_disc_first AS (
        SELECT DISTINCT ON (shipment_id)
          shipment_id,
          ata_loading_completed::date AS ata_vessel_complete_discharge
        FROM vessel_loading_ports
        WHERE COALESCE(is_discharge_port, false) = true
        ORDER BY shipment_id, port_sequence NULLS LAST, id
      )
      SELECT
        s.id,
        s.shipment_id,
        c.contract_id AS contract_number,
        COALESCE(NULLIF(TRIM(c.sto_number::text), ''), NULL) AS sto_number,
        COALESCE(l.contract_ext_no, NULL) AS contract_ext_no,
        s.vessel_name,
        c.supplier,
        c.product,
        c.group_name,
        c.source_type,
        COALESCE(l.data->'contract'->>'ltc_spot', c.contract_type::text) AS lt_spot,
        c.delivery_start_date,
        c.delivery_end_date,
        s.bl_quantity,
        s.quantity_shipped,
        s.actual_vessel_qty_receive,
        GREATEST(COALESCE(c.quantity_ordered, 0) - COALESCE(s.actual_vessel_qty_receive, s.bl_quantity, s.quantity_shipped, 0), 0) AS outstanding_quantity,
        s.daily_deliverables,
        COALESCE(s.ata_discharge_complete::date, vd.ata_vessel_complete_discharge) AS ata_vessel_complete_discharge,
        s.updated_at
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      LEFT JOIN vlp_disc_first vd ON vd.shipment_id = s.id
      WHERE
        COALESCE(c.delivery_start_date, s.shipment_date, c.delivery_end_date, s.arrival_date) <= $2::date
        AND COALESCE(c.delivery_end_date, s.arrival_date, c.delivery_start_date, s.shipment_date) >= $1::date
      ORDER BY COALESCE(s.ata_discharge_complete::date, vd.ata_vessel_complete_discharge) ASC NULLS LAST, COALESCE(c.delivery_start_date, s.shipment_date) ASC NULLS LAST, s.shipment_id ASC
      `,
      [from, to],
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Get shipment daily deliverables calendar error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to load shipment daily planning deliverables' } });
  }
};

export const updateShipmentDailyDeliverables = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { daily_deliverables } = req.body || {};

    const curRes = await query(
      `SELECT s.id,
              c.delivery_start_date,
              c.delivery_end_date,
              COALESCE(s.bl_quantity, s.quantity_shipped, s.actual_vessel_qty_receive) AS max_qty
       FROM shipments s
       LEFT JOIN contracts c ON s.contract_id = c.id
       WHERE s.id = $1
       LIMIT 1`,
      [id],
    );
    if (curRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Shipment not found' } });
    }
    const cur = curRes.rows[0];

    const dd = normalizeAndValidateShipmentDailyDeliverables({
      daily_deliverables,
      startRaw: cur.delivery_start_date,
      endRaw: cur.delivery_end_date,
      maxQtyRaw: cur.max_qty,
    });
    if (!dd.ok) {
      return res.status(400).json({ success: false, error: { message: dd.message } });
    }

    const upd = await query(
      `UPDATE shipments
       SET daily_deliverables = $2::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, JSON.stringify(dd.rows)],
    );

    return res.json({ success: true, data: upd.rows[0], message: 'Shipment daily planning deliverables updated successfully' });
  } catch (error) {
    logger.error('Update shipment daily deliverables error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to update shipment daily planning deliverables' } });
  }
};

export const bulkUploadShipmentDailyDeliverables = async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file?.buffer) {
      return res.status(400).json({ success: false, error: { message: 'File is required (CSV or Excel)' } });
    }

    let matrix: unknown[][];
    try {
      matrix = parsePlanningSheetToMatrix(file.buffer);
    } catch (e: any) {
      return res.status(400).json({ success: false, error: { message: e?.message || 'Could not read spreadsheet' } });
    }
    if (matrix.length < 2) {
      return res.status(400).json({ success: false, error: { message: 'File must include a header row and at least one data row' } });
    }

    const headerRow = matrix[0];
    const extIdx = findPlanningColumnIndex(headerRow, ['contract_ext_no', 'contract ext no', 'ext no']);
    const dateIdx = findPlanningColumnIndex(headerRow, ['date', 'tanggal']);
    const qtyIdx = findPlanningColumnIndex(headerRow, ['quantity_delivered', 'quantity delivered', 'quantity', 'qty']);
    if (extIdx < 0 || dateIdx < 0 || qtyIdx < 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required columns. Expected headers: contract_ext_no, date, quantity_delivered' },
      });
    }

    type ParsedLine = { lineNumber: number; contract_ext_no: string; dateRaw: unknown; qtyRaw: unknown };
    const lines: ParsedLine[] = [];
    const rowParseFailures: { rowNumber: number; contract_ext_no: string; reason: string }[] = [];

    for (let rIdx = 1; rIdx < matrix.length; rIdx++) {
      const row = matrix[rIdx];
      const ext = String(row[extIdx] ?? '').trim();
      const dateRaw = row[dateIdx];
      const qtyCell = row[qtyIdx];
      const emptyRow =
        !ext &&
        (dateRaw === undefined || dateRaw === null || String(dateRaw).trim() === '') &&
        (qtyCell === undefined || qtyCell === null || String(qtyCell).trim() === '');
      if (emptyRow) continue;

      const lineNumber = rIdx + 1;
      if (lines.length >= MAX_BULK_SHIPMENT_PLANNING_ROWS) {
        rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: ext || '-', reason: `File exceeds maximum of ${MAX_BULK_SHIPMENT_PLANNING_ROWS} data rows` });
        break;
      }
      if (!ext) {
        rowParseFailures.push({ rowNumber: lineNumber, contract_ext_no: '-', reason: 'contract_ext_no is required' });
        continue;
      }
      lines.push({ lineNumber, contract_ext_no: ext, dateRaw: dateRaw ?? '', qtyRaw: qtyCell });
    }

    const byExt = new Map<string, ParsedLine[]>();
    for (const ln of lines) {
      const k = ln.contract_ext_no.trim().toLowerCase();
      const list = byExt.get(k) || [];
      list.push(ln);
      byExt.set(k, list);
    }

    const opFailures: { contract_ext_no: string; rowNumbers: number[]; reason: string; shipment_ids?: string[] }[] = [];
    let succeeded = 0;
    let succeededRows = 0;

    for (const [, group] of byExt.entries()) {
      const ext = group[0].contract_ext_no.trim();
      const rowNumbers = group.map((g) => g.lineNumber);
      const dateToLast = new Map<string, { quantity_delivered: number; lineNumber: number }>();
      let validLines = 0;

      for (const g of group) {
        const iso = toIsoDate10FromCell(g.dateRaw);
        if (!iso) {
          rowParseFailures.push({ rowNumber: g.lineNumber, contract_ext_no: ext, reason: 'date is missing or invalid (use DD/MM/YYYY or YYYY-MM-DD)' });
          continue;
        }
        const qn = parseDailyDeliverableQuantity(g.qtyRaw);
        if (qn === null || qn < 0) {
          rowParseFailures.push({ rowNumber: g.lineNumber, contract_ext_no: ext, reason: 'quantity_delivered must be a valid non-negative number' });
          continue;
        }
        dateToLast.set(iso, { quantity_delivered: qn, lineNumber: g.lineNumber });
        validLines += 1;
      }
      if (dateToLast.size === 0) continue;

      const dailyWithLine = Array.from(dateToLast.entries())
        .map(([date, v]) => ({ date, quantity_delivered: v.quantity_delivered, lineNumber: v.lineNumber }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const shipRes = await query(
        `SELECT s.id,
                s.shipment_id,
                c.delivery_start_date,
                c.delivery_end_date,
                COALESCE(s.bl_quantity, s.quantity_shipped, s.actual_vessel_qty_receive) AS max_qty
         FROM shipments s
         LEFT JOIN contracts c ON s.contract_id = c.id
         LEFT JOIN LATERAL (
           SELECT NULLIF(trim(COALESCE(spd.data->'raw'->>'Contract Ext No', spd.data->>'Contract Ext No')), '') AS ext_no
           FROM sap_processed_data spd
           WHERE spd.contract_number = c.contract_id
           ORDER BY spd.created_at DESC NULLS LAST
           LIMIT 1
         ) ext ON true
         WHERE trim(upper(COALESCE(ext.ext_no, ''))) = trim(upper($1::text))`,
        [ext],
      );

      if (shipRes.rows.length === 0) {
        opFailures.push({ contract_ext_no: ext, rowNumbers, reason: 'No shipment found for this Contract Ext No' });
        continue;
      }
      if (shipRes.rows.length > 1) {
        opFailures.push({ contract_ext_no: ext, rowNumbers, reason: 'Multiple shipments share this Contract Ext No; cannot apply upload automatically', shipment_ids: shipRes.rows.map((r: any) => r.shipment_id) });
        continue;
      }

      const cur = shipRes.rows[0];
      const startS = toIsoDate10FromCell(cur.delivery_start_date);
      const endS = toIsoDate10FromCell(cur.delivery_end_date);

      const inWindow =
        startS && endS
          ? dailyWithLine.filter((r) => {
              const ok = r.date >= startS && r.date <= endS;
              if (!ok) {
                rowParseFailures.push({
                  rowNumber: r.lineNumber,
                  contract_ext_no: ext,
                  reason: `date ${r.date} is outside Due Start (${startS}) … Due End (${endS}) and was skipped`,
                });
              }
              return ok;
            })
          : dailyWithLine;

      if (inWindow.length === 0) {
        opFailures.push({
          contract_ext_no: ext,
          rowNumbers,
          reason:
            startS && endS
              ? `All rows are outside Due Start (${startS}) … Due End (${endS}); nothing to upload`
              : 'Due Start/Due End are required when daily deliverables are provided',
        });
        continue;
      }

      const daily = inWindow.map(({ date, quantity_delivered }) => ({ date, quantity_delivered }));
      const dd = normalizeAndValidateShipmentDailyDeliverables({
        daily_deliverables: daily,
        startRaw: cur.delivery_start_date,
        endRaw: cur.delivery_end_date,
        maxQtyRaw: cur.max_qty,
      });
      if (!dd.ok) {
        opFailures.push({ contract_ext_no: ext, rowNumbers, reason: dd.message, shipment_ids: [cur.shipment_id] });
        continue;
      }

      await query(
        `UPDATE shipments SET daily_deliverables = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [cur.id, JSON.stringify(dd.rows)],
      );
      succeeded += 1;
      succeededRows += inWindow.length;
    }

    return res.json({
      success: true,
      data: {
        processedRows: lines.length,
        succeededOperations: succeeded,
        failedOperations: opFailures.length,
        succeededRows,
        rowLevelIssues: rowParseFailures.length,
        operationLevelFailures: opFailures.length,
        rowParseFailures,
        operationFailures: opFailures,
      },
    });
  } catch (error) {
    logger.error('Bulk upload shipment daily planning deliverables error:', error);
    return res.status(500).json({ success: false, error: { message: 'Failed to process upload' } });
  }
};

// Get contract suggestions for auto-complete
export const getContractSuggestions = async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    
    if (!q || String(q).trim().length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const result = await query(
      `
      SELECT 
        c.contract_id,
        c.po_number,
        c.supplier,
        c.product,
        c.group_name,
        c.sto_number,
        c.sto_quantity
      FROM contracts c
      WHERE UPPER(COALESCE(c.status, '')) IN ('OPEN', 'ACTIVE')
        AND (
          c.po_number ILIKE $1
          OR c.contract_id ILIKE $1
        )
      ORDER BY COALESCE(NULLIF(TRIM(c.po_number), ''), c.contract_id)
      LIMIT 10
    `,
      [`%${q}%`],
    );

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get contract suggestions error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to get contract suggestions' },
    });
  }
};

// Validate contract number and return contract details
export const validateContractNumber = async (req: AuthRequest, res: Response) => {
  try {
    const { contract_number } = req.query;

    if (!contract_number) {
      return res.status(400).json({
        success: false,
        error: { message: 'Contract number is required' },
      });
    }

    const raw = String(contract_number).trim();
    const result = await query(
      `
      WITH matched AS (
        SELECT c.*
        FROM contracts c
        WHERE c.contract_id = $1
           OR c.po_number = $1
        ORDER BY (c.contract_id = $1) DESC
        LIMIT 1
      )
      SELECT 
        c.id,
        c.contract_id,
        c.po_number,
        c.sto_number,
        c.supplier,
        c.buyer,
        c.product,
        c.group_name,
        c.quantity_ordered,
        COALESCE(
          c.quantity_ordered - COALESCE(
            CASE
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('FRC', 'CIF', 'CFR') THEN (
                SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC))
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                  AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL
              )
              WHEN UPPER(TRIM(COALESCE(c.incoterm, ''))) IN ('LCO', 'FOB') THEN (
                SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC))
                FROM sap_processed_data spd
                WHERE spd.contract_number = c.contract_id
                  AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL
              )
              ELSE (
                SELECT SUM(CAST(REPLACE(REPLACE(data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
                FROM sap_processed_data 
                WHERE contract_number = c.contract_id 
                  AND sto_number IS NOT NULL 
                  AND data->'contract'->>'sto_quantity' IS NOT NULL
              )
            END,
            0
          ),
          c.quantity_ordered
        ) AS outstanding_quantity,
        c.unit,
        c.delivery_start_date,
        c.delivery_end_date,
        c.transport_mode,
        -- Ports are not stored on contracts; derive from latest SAP processed data if available
        NULLIF(NULLIF((
          SELECT spd.data->'shipment'->>'vessel_loading_port_1'
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
            AND spd.data->'shipment'->>'vessel_loading_port_1' IS NOT NULL
            AND TRIM(spd.data->'shipment'->>'vessel_loading_port_1') <> ''
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1
        ), ''), '0.00') as port_of_loading,
        NULLIF(NULLIF((
          SELECT spd.data->'shipment'->>'vessel_discharge_port'
          FROM sap_processed_data spd
          WHERE spd.contract_number = c.contract_id
            AND spd.data->'shipment'->>'vessel_discharge_port' IS NOT NULL
            AND TRIM(spd.data->'shipment'->>'vessel_discharge_port') <> ''
          ORDER BY spd.created_at DESC NULLS LAST
          LIMIT 1
        ), ''), '0.00') as port_of_discharge
      FROM matched c
      LIMIT 1
      `,
      [raw]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        exists: false,
        message: 'Contract number does not exist',
      });
    }

    return res.json({
      success: true,
      exists: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Validate contract number error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to validate contract number' },
    });
  }
};

// Check if STO number already exists
export const checkStoExists = async (req: AuthRequest, res: Response) => {
  try {
    const { stoNumber } = req.params;
    
    const result = await query(`
      SELECT 
        sto_number,
        STRING_AGG(DISTINCT contract_id, ', ' ORDER BY contract_id) as contract_numbers,
        COUNT(DISTINCT contract_id) as contract_count
      FROM contracts 
      WHERE sto_number = $1
      GROUP BY sto_number
    `, [stoNumber]);

    if (result.rows.length > 0) {
      return res.json({
        success: true,
        exists: true,
        data: result.rows[0]
      });
    }

    return res.json({
      success: true,
      exists: false,
      data: null
    });
  } catch (error) {
    logger.error('Check STO exists error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to check STO number' },
    });
  }
};

// Create new shipment
// Get contract details with STO quantity assigned for a specific STO
export const getContractDetailsForSto = async (req: AuthRequest, res: Response) => {
  try {
    const { sto, contractNumbers } = req.query;

    if (!sto) {
      return res.status(400).json({
        success: false,
        error: { message: 'STO number is required' },
      });
    }

    const contractList = contractNumbers ? String(contractNumbers).split(',').map(c => c.trim()).filter(Boolean) : [];

    // Ensure user_sto_contract_assignments table exists (it is created in updateStoQtyAssigned,
    // but that endpoint may not have been called yet on a fresh database)
    await query(`
      CREATE TABLE IF NOT EXISTS user_sto_contract_assignments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sto_number VARCHAR(255) NOT NULL,
        contract_number VARCHAR(255) NOT NULL,
        sto_qty_assigned NUMERIC(15, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sto_number, contract_number)
      )
    `);

    // Get ALL contract numbers linked to this STO: column sto_number OR STO in raw/shipment/contract JSON
    const sapResult = await query(
      `SELECT DISTINCT contract_number FROM sap_processed_data
       WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
         AND (
           TRIM(COALESCE(sto_number::text, '')) = TRIM($1::text)
           OR NULLIF(TRIM(COALESCE(data->'raw'->>'STO No.', data->'raw'->>'STO Number', data->'shipment'->>'sto_no', data->'contract'->>'sto_no', data->>'STO No.', data->>'STO Number')), '') = TRIM($1::text)
         )`,
      [sto]
    );
    const sapContractNumbers = (sapResult.rows || []).map((r: { contract_number: string }) => r.contract_number);
    const allContractNumbers = [...new Set([...contractList, ...sapContractNumbers])].filter(Boolean);

    if (allContractNumbers.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    // Build one row per contract: use unnest so we include contracts that exist only in sap_processed_data (not in contracts table)
    const queryText = `
      WITH ac AS (SELECT unnest($2::text[]) AS contract_number)
      SELECT 
        ac.contract_number as contract_number,
        COALESCE(MAX(c.quantity_ordered), 0) as contract_qty,
        COALESCE(MAX(c.quantity_ordered), 0) - COALESCE((
          SELECT SUM(CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC))
          FROM sap_processed_data spd
          WHERE spd.contract_number = ac.contract_number
          AND spd.sto_number IS NOT NULL
          AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
        ), 0) as outstanding_qty,
        COALESCE(
          (SELECT sto_qty_assigned FROM user_sto_contract_assignments 
           WHERE sto_number = $1 AND contract_number = ac.contract_number 
           LIMIT 1),
          (SELECT CAST(REPLACE(REPLACE(spd.data->'contract'->>'sto_quantity', ',', ''), ' ', '') AS NUMERIC)
           FROM sap_processed_data spd
           WHERE spd.contract_number = ac.contract_number
           AND spd.sto_number = $1
           AND spd.data->'contract'->>'sto_quantity' IS NOT NULL
           ORDER BY spd.created_at DESC
           LIMIT 1),
          0
        ) as sto_qty_assigned,
        (SELECT STRING_AGG(DISTINCT c2.po_number, ', ' ORDER BY c2.po_number) FILTER (WHERE c2.po_number IS NOT NULL AND c2.po_number != '')
         FROM contracts c2 WHERE c2.contract_id = ac.contract_number) as po_number,
        (SELECT MAX(c2.delivery_start_date) FROM contracts c2 WHERE c2.contract_id = ac.contract_number) as delivery_start_date,
        (SELECT MAX(c2.delivery_end_date) FROM contracts c2 WHERE c2.contract_id = ac.contract_number) as delivery_end_date,
        COALESCE(
          (SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery'), ',', ''), ' ', '') AS NUMERIC))
           FROM sap_processed_data spd
           WHERE spd.contract_number = ac.contract_number
           AND spd.sto_number = $1
           AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Delivered', spd.data->'raw'->>'Quantity Delivery')), '') IS NOT NULL),
          0
        ) as quantity_delivered,
        COALESCE(
          (SELECT SUM(CAST(REPLACE(REPLACE(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive'), ',', ''), ' ', '') AS NUMERIC))
           FROM sap_processed_data spd
           WHERE spd.contract_number = ac.contract_number
           AND spd.sto_number = $1
           AND NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Quantity Receive', spd.data->'raw'->>'Qty Receive')), '') IS NOT NULL),
          0
        ) as quantity_receive,
        -- Contract Ext No from latest sap_processed_data for this contract
        (SELECT COALESCE(
                  spd.data->'raw'->>'Contract Ext No',
                  spd.data->>'Contract Ext No'
                )
         FROM sap_processed_data spd
         WHERE spd.contract_number = ac.contract_number
         ORDER BY spd.created_at DESC NULLS LAST
         LIMIT 1) AS contract_ext_no,
        -- Lock flag: if STO quantity is present in sap_processed_data for this STO+contract, treat as non-editable
        EXISTS (
          SELECT 1
          FROM sap_processed_data spd_lock
          WHERE spd_lock.contract_number = ac.contract_number
            AND spd_lock.sto_number = $1
            AND spd_lock.data->'contract'->>'sto_quantity' IS NOT NULL
        ) AS locked_from_sap
      FROM ac
      LEFT JOIN contracts c ON c.contract_id = ac.contract_number
      -- Shipments contract details must be SEA-only
      WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) = 'SEA'
      GROUP BY ac.contract_number
    `;

    const result = await query(queryText, [sto, allContractNumbers]);

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error('Get contract details for STO error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch contract details' },
    });
  }
};

// Update STO quantity assigned for a contract (user input)
export const updateStoQtyAssigned = async (req: AuthRequest, res: Response) => {
  try {
    const { sto, contractNumber, stoQtyAssigned } = req.body;

    if (!sto || !contractNumber || stoQtyAssigned === undefined) {
      return res.status(400).json({
        success: false,
        error: { message: 'STO number, contract number, and STO quantity assigned are required' },
      });
    }

    // Create table if it doesn't exist (for user input storage)
    await query(`
      CREATE TABLE IF NOT EXISTS user_sto_contract_assignments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sto_number VARCHAR(255) NOT NULL,
        contract_number VARCHAR(255) NOT NULL,
        sto_qty_assigned NUMERIC(15, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(sto_number, contract_number)
      )
    `);

    // Create update timestamp trigger if it doesn't exist
    await query(`
      CREATE OR REPLACE FUNCTION update_user_sto_contract_assignments_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await query(`
      DROP TRIGGER IF EXISTS update_user_sto_contract_assignments_updated_at ON user_sto_contract_assignments;
      CREATE TRIGGER update_user_sto_contract_assignments_updated_at
      BEFORE UPDATE ON user_sto_contract_assignments
      FOR EACH ROW EXECUTE FUNCTION update_user_sto_contract_assignments_updated_at();
    `);

    // Upsert the STO quantity assigned
    await query(`
      INSERT INTO user_sto_contract_assignments (sto_number, contract_number, sto_qty_assigned)
      VALUES ($1, $2, $3::numeric)
      ON CONFLICT (sto_number, contract_number)
      DO UPDATE SET 
        sto_qty_assigned = EXCLUDED.sto_qty_assigned,
        updated_at = CURRENT_TIMESTAMP
    `, [sto, contractNumber, parseFloat(String(stoQtyAssigned)) || 0]);

    return res.json({
      success: true,
      message: 'STO quantity assigned updated successfully',
    });
  } catch (error) {
    logger.error('Update STO quantity assigned error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to update STO quantity assigned' },
    });
  }
};

export const createShipment = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      operationId,
      stoNumber, 
      contractNumbers, 
      contractQtyAssigned,
      vesselName, 
      vesselCode, 
      voyageNo, 
      vesselOwner,
      vesselDraft,
      vesselCapacity,
      vesselHullType,
      charterType,
      portOfLoading,
      portOfDischarge,
      quantityShipped,
      eta_arrival,
      eta_berthed,
      eta_loading_start,
      eta_loading_complete,
      eta_sailed,
      eta_discharge_arrival,
      eta_discharge_berthed,
      eta_discharge_start,
      eta_discharge_complete
    } = req.body;

    // Validate required fields - Contract Numbers are required, STO Number is optional
    if (!contractNumbers || !Array.isArray(contractNumbers) || contractNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'At least one Contract Number is required' },
      });
    }

    // For manual shipments, STO Number should be empty (will be filled from SAP Data later)
    // Only check STO if it's explicitly provided and not empty
    const hasStoNumber = stoNumber && stoNumber.trim() !== ''
    if (hasStoNumber) {
      const stoCheck = await query(`
        SELECT sto_number FROM contracts WHERE sto_number = $1 LIMIT 1
      `, [stoNumber]);

      if (stoCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: { message: `STO Number ${stoNumber} already exists. Please update the existing shipment instead of creating a new one.` },
        });
      }
    }

    // Validate that all contract numbers exist
    const contractCheck = await query(`
      SELECT contract_id, id FROM contracts 
      WHERE contract_id = ANY($1)
    `, [contractNumbers]);

    if (contractCheck.rows.length !== contractNumbers.length) {
      const foundContracts = contractCheck.rows.map(row => row.contract_id);
      const missingContracts = contractNumbers.filter(id => !foundContracts.includes(id));
      return res.status(400).json({
        success: false,
        error: { message: `The following contract numbers do not exist: ${missingContracts.join(', ')}` },
      });
    }

    // Create shipment for each contract
    // All shipments will share the same operation_id (one transaction)
    // If STO is not provided (manual shipment), operation_id is used as the grouping key in list queries.
    const shipmentIds = [];
    const timestamp = Date.now().toString()
    
    // Validate assigned qty sum <= vessel capacity (if provided)
    if (vesselCapacity != null && contractQtyAssigned && typeof contractQtyAssigned === 'object') {
      const cap = parseFloat(String(vesselCapacity))
      if (!Number.isNaN(cap)) {
        const sumAssigned = Object.values(contractQtyAssigned as Record<string, any>).reduce((sum: number, v: any) => {
          const n = parseFloat(String(v))
          return sum + (Number.isNaN(n) ? 0 : n)
        }, 0)
        if (sumAssigned > cap) {
          return res.status(400).json({
            success: false,
            error: { message: `Sum of "Contract Qty assign to STO" (${sumAssigned}) cannot exceed Vessel Capacity (${cap}).` },
          });
        }
      }
    }

    let resolvedOperationId: string | null =
      operationId != null && String(operationId).trim() !== ''
        ? String(operationId).trim()
        : null;
    if (!resolvedOperationId && !hasStoNumber) {
      const dmy = formatDDMMYYYY(new Date());
      const seq = await allocateNextSyntheticSequenceDefault('shipments', 'SEA', dmy);
      resolvedOperationId = buildSyntheticOperationId('SEA', dmy, seq);
    }

    for (const contract of contractCheck.rows) {
      // Generate shipment_id:
      // - If STO is provided, use "<STO>-<CONTRACT_ID>" so all contracts under an STO can be grouped
      // - If STO is NOT provided (manual shipment), generate an internal unique id (do NOT mirror operation_id),
      //   and keep STO empty until it is updated from SAP.
      const shipmentId = hasStoNumber
        ? `${stoNumber}-${contract.contract_id}`
        : `MNL-${timestamp.slice(-8)}-${contract.contract_id}`;
      
      const result = await query(`
        INSERT INTO shipments (
          shipment_id, operation_id, contract_id, vessel_name, vessel_code, voyage_no, vessel_owner,
          vessel_draft, vessel_capacity, vessel_hull_type, charter_type,
          port_of_loading, port_of_discharge, quantity_shipped,
          eta_arrival, eta_berthed, eta_loading_start, eta_loading_complete, eta_sailed,
          eta_discharge_arrival, eta_discharge_berthed, eta_discharge_start, eta_discharge_complete,
          status
        ) VALUES (
          $1, $2, $3::uuid, $4, $5, $6, $7, $8::numeric, $9::numeric, $10, $11,
          $12, $13, $14::numeric,
          $15::date, $16::date, $17::date, $18::date, $19::date,
          $20::date, $21::date, $22::date, $23::date,
          'PLANNED'
        ) RETURNING id
      `, [
        shipmentId,
        resolvedOperationId,
        contract.id,
        vesselName || null,
        vesselCode || null,
        voyageNo || null,
        vesselOwner || null,
        vesselDraft ? parseFloat(String(vesselDraft)) : null,
        vesselCapacity ? parseFloat(String(vesselCapacity)) : null,
        vesselHullType || null,
        charterType || null,
        portOfLoading || null,
        portOfDischarge || null,
        quantityShipped ? parseFloat(String(quantityShipped)) : null,
        eta_arrival || null,
        eta_berthed || null,
        eta_loading_start || null,
        eta_loading_complete || null,
        eta_sailed || null,
        eta_discharge_arrival || null,
        eta_discharge_berthed || null,
        eta_discharge_start || null,
        eta_discharge_complete || null
      ]);

      shipmentIds.push(result.rows[0].id);
    }

    // Persist user contract qty assignment (keyed by STO if exists; else operationId; else shipment_id)
    if (contractQtyAssigned && typeof contractQtyAssigned === 'object') {
      const assignmentKey = (hasStoNumber && stoNumber && String(stoNumber).trim())
        ? String(stoNumber).trim()
        : (resolvedOperationId && String(resolvedOperationId).trim())
          ? String(resolvedOperationId).trim()
          : `MNL-${timestamp.slice(-8)}`;

      // Ensure table exists
      await query(`
        CREATE TABLE IF NOT EXISTS user_sto_contract_assignments (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          sto_number VARCHAR(255) NOT NULL,
          contract_number VARCHAR(255) NOT NULL,
          sto_qty_assigned NUMERIC(15, 2) NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(sto_number, contract_number)
        )
      `);

      for (const [contractNumber, qty] of Object.entries(contractQtyAssigned as Record<string, any>)) {
        if (!contractNumber) continue;
        const n = parseFloat(String(qty));
        await query(
          `
          INSERT INTO user_sto_contract_assignments (sto_number, contract_number, sto_qty_assigned)
          VALUES ($1, $2, $3::numeric)
          ON CONFLICT (sto_number, contract_number)
          DO UPDATE SET sto_qty_assigned = EXCLUDED.sto_qty_assigned, updated_at = CURRENT_TIMESTAMP
          `,
          [assignmentKey, String(contractNumber).trim(), Number.isNaN(n) ? 0 : n]
        );
      }
    }

    // Update contracts with STO number (only if STO is explicitly provided)
    // For manual shipments, STO remains empty and will be filled from SAP Data later
    if (hasStoNumber) {
      await query(`
        UPDATE contracts 
        SET sto_number = $1, updated_at = CURRENT_TIMESTAMP
        WHERE contract_id = ANY($2)
      `, [stoNumber, contractNumbers]);
    }

    return res.json({
      success: true,
      message: stoNumber 
        ? `Shipment created successfully for STO ${stoNumber}`
        : `Shipment created successfully for contracts: ${contractNumbers.join(', ')}`,
      data: {
        stoNumber: stoNumber || null,
        contractNumbers,
        shipmentIds
      }
    });
  } catch (error: any) {
    logger.error('Create shipment error:', error);
    return res.status(500).json({
      success: false,
      error: { 
        message: error.message || 'Failed to create shipment',
        details: error.detail || error.toString()
      },
    });
  }
};
