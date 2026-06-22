import { query } from '../database/connection';
import {
  callClaudeForJson,
  KLIP_LOGISTICS_SYSTEM_PROMPT,
  normalizePatternKey,
  shiftIsoDate,
} from '../utils/anthropicClient';
import logger from '../utils/logger';

export type VesselSuggestInput = {
  supplier_id: string;
  buyer_id: string;
  product_id: string;
  incoterm: string;
};

export type VesselSuggestResult = {
  suggested_vessel_name: string;
  suggested_charter_type: string | null;
  suggested_discharge_port: string | null;
  suggested_loading_port: string | null;
  source: 'SAP_HISTORICAL' | 'CLAUDE_AI';
  cached: boolean;
};

export type EtaSuggestInput = {
  vessel_name: string;
  loading_port: string;
  discharge_port: string;
  loading_date: string;
};

export type EtaMilestones = {
  etaVesselArrivalAtLoadingPort: string;
  etaVesselBerthedAtLoadingPort: string;
  etaVesselStartLoading: string;
  etaVesselCompletedLoading: string;
  etaVesselSailedFromLoadingPort: string;
  etaVesselArriveAtDischargePort: string;
  etaVesselBerthedAtDischargePort: string;
  etaVesselStartDischarging: string;
  etaVesselCompleteDischarge: string;
};

export type EtaSuggestResult = {
  avg_transit_days: number;
  source: 'SAP_HISTORICAL' | 'CLAUDE_AI';
  cached: boolean;
  milestones: EtaMilestones;
};

function normalizeDims(input: VesselSuggestInput) {
  return {
    supplier_id: normalizePatternKey(input.supplier_id),
    buyer_id: normalizePatternKey(input.buyer_id),
    product_id: normalizePatternKey(input.product_id),
    incoterm: normalizePatternKey(input.incoterm),
  };
}

function normalizeRoute(input: EtaSuggestInput) {
  return {
    vessel_name: String(input.vessel_name ?? '').trim(),
    loading_port: String(input.loading_port ?? '').trim(),
    discharge_port: String(input.discharge_port ?? '').trim(),
    loading_date: String(input.loading_date ?? '').trim().slice(0, 10),
  };
}

/** Map stored charter labels to the three UI options (CIF | V/C | T/C). */
function normalizeCharterType(value: unknown): string | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'CIF') return 'CIF';
  if (raw === 'V/C' || raw === 'VC' || raw === 'V-C' || raw === 'VOYAGE CHARTER') return 'V/C';
  if (raw === 'T/C' || raw === 'TC' || raw === 'T-C' || raw === 'TIME CHARTER') return 'T/C';
  if (raw.includes('TIME')) return 'T/C';
  if (raw.includes('VOYAGE') || (raw.includes('V') && raw.includes('C'))) return 'V/C';
  return null;
}

async function queryKlipCharterMode(whereSql: string, params: string[]): Promise<string | null> {
  const result = await query(
    `SELECT
       NULLIF(TRIM(s.charter_type), '') AS charter_type,
       COUNT(*)::int AS usage_count
     FROM shipments s
     INNER JOIN contracts c ON c.id = s.contract_id
     WHERE ${whereSql}
       AND NULLIF(TRIM(s.charter_type), '') IS NOT NULL
     GROUP BY 1
     ORDER BY usage_count DESC, charter_type ASC
     LIMIT 1`,
    params,
  );
  const row = result.rows[0] as { charter_type?: string } | undefined;
  return normalizeCharterType(row?.charter_type);
}

/**
 * Most common charter_type from past Klip shipments, widening the match tier by tier.
 * SAP imports do not carry charter type — this is the primary Klip-native signal.
 */
async function findKlipHistoricalCharterType(
  dims: ReturnType<typeof normalizeDims>,
): Promise<string | null> {
  const tiers: Array<{ whereSql: string; params: string[] }> = [
    {
      whereSql: `UPPER(TRIM(c.supplier)) = $1
        AND UPPER(TRIM(c.buyer)) = $2
        AND UPPER(TRIM(c.product)) = $3
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) = $4`,
      params: [dims.supplier_id, dims.buyer_id, dims.product_id, dims.incoterm],
    },
    {
      whereSql: `UPPER(TRIM(c.supplier)) = $1
        AND UPPER(TRIM(c.buyer)) = $2
        AND UPPER(TRIM(c.product)) = $3`,
      params: [dims.supplier_id, dims.buyer_id, dims.product_id],
    },
    {
      whereSql: `UPPER(TRIM(c.supplier)) = $1
        AND UPPER(TRIM(c.product)) = $2
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) = $3`,
      params: [dims.supplier_id, dims.product_id, dims.incoterm],
    },
    {
      whereSql: `UPPER(TRIM(c.buyer)) = $1
        AND UPPER(TRIM(c.product)) = $2
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) = $3`,
      params: [dims.buyer_id, dims.product_id, dims.incoterm],
    },
    {
      whereSql: `UPPER(TRIM(c.product)) = $1
        AND UPPER(TRIM(COALESCE(c.incoterm, ''))) = $2`,
      params: [dims.product_id, dims.incoterm],
    },
  ];

  for (const tier of tiers) {
    const charter = await queryKlipCharterMode(tier.whereSql, tier.params);
    if (charter) return charter;
  }
  return null;
}

async function enrichVesselResultWithCharterType(
  dims: ReturnType<typeof normalizeDims>,
  result: VesselSuggestResult,
): Promise<VesselSuggestResult> {
  const normalized = normalizeCharterType(result.suggested_charter_type);
  if (normalized) {
    return { ...result, suggested_charter_type: normalized };
  }

  const fromKlip = await findKlipHistoricalCharterType(dims);
  const fromIncoterm =
    !fromKlip && dims.incoterm === 'CIF' ? 'CIF' : null;
  const resolvedCharter = fromKlip ?? fromIncoterm;
  if (!resolvedCharter) return result;

  const enriched: VesselSuggestResult = {
    ...result,
    suggested_charter_type: resolvedCharter,
  };

  if (result.suggested_vessel_name) {
    try {
      await upsertVesselPattern(dims, {
        suggested_vessel_name: result.suggested_vessel_name,
        suggested_charter_type: resolvedCharter,
        suggested_discharge_port: result.suggested_discharge_port,
        suggested_loading_port: result.suggested_loading_port,
        source: result.source,
      });
    } catch (error) {
      logger.warn('Failed to backfill vessel_patterns charter_type', { error, dims });
    }
  }

  return enriched;
}

function mapCachedVesselRow(row: Record<string, unknown>): VesselSuggestResult {
  return {
    suggested_vessel_name: String(row.suggested_vessel_name ?? ''),
    suggested_charter_type: normalizeCharterType(row.suggested_charter_type),
    suggested_discharge_port: row.suggested_discharge_port
      ? String(row.suggested_discharge_port)
      : null,
    suggested_loading_port: row.suggested_loading_port
      ? String(row.suggested_loading_port)
      : null,
    source: row.source as 'SAP_HISTORICAL' | 'CLAUDE_AI',
    cached: true,
  };
}

async function findCachedVesselPattern(dims: ReturnType<typeof normalizeDims>) {
  const result = await query(
    `SELECT *
     FROM vessel_patterns
     WHERE supplier_id = $1
       AND buyer_id = $2
       AND product_id = $3
       AND incoterm = $4
     LIMIT 1`,
    [dims.supplier_id, dims.buyer_id, dims.product_id, dims.incoterm],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function findSapHistoricalVessel(dims: ReturnType<typeof normalizeDims>) {
  const result = await query(
    `SELECT
       TRIM(s.vessel_name) AS suggested_vessel_name,
       NULLIF(TRIM(s.charter_type), '') AS suggested_charter_type,
       NULLIF(TRIM(s.port_of_discharge), '') AS suggested_discharge_port,
       NULLIF(TRIM(s.port_of_loading), '') AS suggested_loading_port,
       COUNT(*)::int AS usage_count
     FROM shipments s
     INNER JOIN contracts c ON c.id = s.contract_id
     WHERE UPPER(TRIM(c.supplier)) = $1
       AND UPPER(TRIM(c.buyer)) = $2
       AND UPPER(TRIM(c.product)) = $3
       AND UPPER(TRIM(COALESCE(c.incoterm, ''))) = $4
       AND NULLIF(TRIM(s.vessel_name), '') IS NOT NULL
     GROUP BY 1, 2, 3, 4
     ORDER BY usage_count DESC, suggested_vessel_name ASC
     LIMIT 1`,
    [dims.supplier_id, dims.buyer_id, dims.product_id, dims.incoterm],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

const SAP_DIM_SUPPLIER = `COALESCE(spd.data->'contract'->>'supplier', spd.data->'raw'->>'Supplier', '')`;
const SAP_DIM_BUYER = `COALESCE(spd.data->'contract'->>'buyer', spd.data->'raw'->>'Buyer', '')`;
const SAP_DIM_PRODUCT = `COALESCE(spd.data->'contract'->>'product', spd.data->'raw'->>'Product', '')`;
const SAP_DIM_INCOTERM = `COALESCE(spd.data->'contract'->>'incoterm', spd.data->'raw'->>'Incoterms', '')`;
const SAP_VESSEL_EXPR = `NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Vessel Name', spd.data->'shipment'->>'vessel_name')), '')`;
const SAP_DISCHARGE_EXPR = `NULLIF(TRIM(COALESCE(spd.data->'raw'->>'Vessel Discharge Port', spd.data->'shipment'->>'vessel_discharge_port')), '')`;
const SAP_LOADING_EXPR = `NULLIF(TRIM(COALESCE(
  spd.data->'raw'->>'Vessel Loading Port 1',
  spd.data->'shipment'->>'vessel_loading_port_1',
  spd.data->'raw'->>'Port of Loading'
)), '')`;

function normalizeSapPortName(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '0' || raw === '0.00') return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return null;
  return raw;
}

async function querySapProcessedVesselMode(
  whereSql: string,
  params: string[],
): Promise<Record<string, unknown> | undefined> {
  const result = await query(
    `SELECT
       ${SAP_VESSEL_EXPR} AS suggested_vessel_name,
       NULLIF(TRIM(COALESCE(spd.data->'shipment'->>'charter_type', '')), '') AS suggested_charter_type,
       ${SAP_DISCHARGE_EXPR} AS suggested_discharge_port,
       ${SAP_LOADING_EXPR} AS suggested_loading_port,
       COUNT(*)::int AS usage_count
     FROM sap_processed_data spd
     WHERE ${whereSql}
       AND ${SAP_VESSEL_EXPR} IS NOT NULL
     GROUP BY 1, 2, 3, 4
     ORDER BY usage_count DESC, suggested_vessel_name ASC
     LIMIT 1`,
    params,
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

/** SAP import history (sap_processed_data) with widened dimension tiers — unplanned POs often lack vessel on the exact row. */
async function findSapProcessedHistoricalVessel(
  dims: ReturnType<typeof normalizeDims>,
): Promise<Record<string, unknown> | undefined> {
  const tiers: Array<{ whereSql: string; params: string[] }> = [
    {
      whereSql: `UPPER(TRIM(${SAP_DIM_SUPPLIER})) = $1
        AND UPPER(TRIM(${SAP_DIM_BUYER})) = $2
        AND UPPER(TRIM(${SAP_DIM_PRODUCT})) = $3
        AND UPPER(TRIM(COALESCE(${SAP_DIM_INCOTERM}, ''))) = $4`,
      params: [dims.supplier_id, dims.buyer_id, dims.product_id, dims.incoterm],
    },
    {
      whereSql: `UPPER(TRIM(${SAP_DIM_SUPPLIER})) = $1
        AND UPPER(TRIM(${SAP_DIM_BUYER})) = $2
        AND UPPER(TRIM(${SAP_DIM_PRODUCT})) = $3`,
      params: [dims.supplier_id, dims.buyer_id, dims.product_id],
    },
    {
      whereSql: `UPPER(TRIM(${SAP_DIM_SUPPLIER})) = $1
        AND UPPER(TRIM(${SAP_DIM_BUYER})) = $2`,
      params: [dims.supplier_id, dims.buyer_id],
    },
    {
      whereSql: `UPPER(TRIM(${SAP_DIM_BUYER})) = $1
        AND UPPER(TRIM(${SAP_DIM_PRODUCT})) = $2
        AND UPPER(TRIM(COALESCE(${SAP_DIM_INCOTERM}, ''))) = $3`,
      params: [dims.buyer_id, dims.product_id, dims.incoterm],
    },
    {
      whereSql: `UPPER(TRIM(${SAP_DIM_BUYER})) = $1
        AND UPPER(TRIM(${SAP_DIM_PRODUCT})) = $2`,
      params: [dims.buyer_id, dims.product_id],
    },
    {
      whereSql: `UPPER(TRIM(${SAP_DIM_BUYER})) = $1`,
      params: [dims.buyer_id],
    },
  ];

  for (const tier of tiers) {
    const row = await querySapProcessedVesselMode(tier.whereSql, tier.params);
    if (row?.suggested_vessel_name) return row;
  }
  return undefined;
}

function mapSapProcessedVesselRow(row: Record<string, unknown>) {
  return {
    suggested_vessel_name: String(row.suggested_vessel_name ?? '').trim(),
    suggested_charter_type: normalizeCharterType(row.suggested_charter_type),
    suggested_discharge_port: normalizeSapPortName(row.suggested_discharge_port),
    suggested_loading_port: normalizeSapPortName(row.suggested_loading_port),
    source: 'SAP_HISTORICAL' as const,
  };
}

async function fetchSapSegmentsForVessel(dims: ReturnType<typeof normalizeDims>) {
  const result = await query(
    `SELECT
       spd.contract_number AS contract_id,
       ${SAP_DIM_SUPPLIER} AS supplier,
       ${SAP_DIM_BUYER} AS buyer,
       ${SAP_DIM_PRODUCT} AS product,
       ${SAP_DIM_INCOTERM} AS incoterm,
       ${SAP_VESSEL_EXPR} AS sap_vessel_name,
       NULLIF(TRIM(COALESCE(spd.data->'shipment'->>'charter_type', '')), '') AS sap_charter_type,
       ${SAP_DISCHARGE_EXPR} AS sap_discharge_port,
       ${SAP_LOADING_EXPR} AS sap_loading_port
     FROM sap_processed_data spd
     WHERE ${SAP_VESSEL_EXPR} IS NOT NULL
       AND (
         (
           UPPER(TRIM(${SAP_DIM_SUPPLIER})) = $1
           AND UPPER(TRIM(${SAP_DIM_BUYER})) = $2
           AND UPPER(TRIM(${SAP_DIM_PRODUCT})) = $3
         )
         OR (
           UPPER(TRIM(${SAP_DIM_BUYER})) = $2
           AND UPPER(TRIM(${SAP_DIM_PRODUCT})) = $3
         )
         OR (
           UPPER(TRIM(${SAP_DIM_SUPPLIER})) = $1
           AND UPPER(TRIM(${SAP_DIM_BUYER})) = $2
         )
       )
     ORDER BY
       CASE
         WHEN UPPER(TRIM(${SAP_DIM_SUPPLIER})) = $1
          AND UPPER(TRIM(${SAP_DIM_BUYER})) = $2
          AND UPPER(TRIM(${SAP_DIM_PRODUCT})) = $3
          AND UPPER(TRIM(COALESCE(${SAP_DIM_INCOTERM}, ''))) = $4 THEN 0
         WHEN UPPER(TRIM(${SAP_DIM_SUPPLIER})) = $1
          AND UPPER(TRIM(${SAP_DIM_BUYER})) = $2
          AND UPPER(TRIM(${SAP_DIM_PRODUCT})) = $3 THEN 1
         WHEN UPPER(TRIM(${SAP_DIM_BUYER})) = $2
          AND UPPER(TRIM(${SAP_DIM_PRODUCT})) = $3 THEN 2
         ELSE 3
       END,
       spd.created_at DESC NULLS LAST
     LIMIT 25`,
    [dims.supplier_id, dims.buyer_id, dims.product_id, dims.incoterm],
  );
  return result.rows;
}

async function upsertVesselPattern(
  dims: ReturnType<typeof normalizeDims>,
  payload: {
    suggested_vessel_name: string;
    suggested_charter_type: string | null;
    suggested_discharge_port: string | null;
    suggested_loading_port: string | null;
    source: 'SAP_HISTORICAL' | 'CLAUDE_AI';
  },
) {
  await query(
    `INSERT INTO vessel_patterns (
       supplier_id, buyer_id, product_id, incoterm,
       suggested_vessel_name, suggested_charter_type, suggested_discharge_port,
       suggested_loading_port, source, last_updated
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     ON CONFLICT (supplier_id, buyer_id, product_id, incoterm)
     DO UPDATE SET
       suggested_vessel_name = EXCLUDED.suggested_vessel_name,
       suggested_charter_type = EXCLUDED.suggested_charter_type,
       suggested_discharge_port = EXCLUDED.suggested_discharge_port,
       suggested_loading_port = EXCLUDED.suggested_loading_port,
       source = EXCLUDED.source,
       last_updated = CURRENT_TIMESTAMP`,
    [
      dims.supplier_id,
      dims.buyer_id,
      dims.product_id,
      dims.incoterm,
      payload.suggested_vessel_name,
      payload.suggested_charter_type,
      payload.suggested_discharge_port,
      payload.suggested_loading_port,
      payload.source,
    ],
  );
}

export async function suggestVesselForShipment(
  input: VesselSuggestInput,
): Promise<VesselSuggestResult> {
  const dims = normalizeDims(input);
  if (!dims.supplier_id || !dims.buyer_id || !dims.product_id) {
    throw new Error('supplier_id, buyer_id, and product_id are required');
  }

  const cached = await findCachedVesselPattern(dims);
  if (cached?.suggested_vessel_name) {
    return enrichVesselResultWithCharterType(dims, mapCachedVesselRow(cached));
  }

  const sapHistorical = await findSapHistoricalVessel(dims);
  if (sapHistorical?.suggested_vessel_name) {
    const payload = {
      suggested_vessel_name: String(sapHistorical.suggested_vessel_name),
      suggested_charter_type: normalizeCharterType(sapHistorical.suggested_charter_type),
      suggested_discharge_port: sapHistorical.suggested_discharge_port
        ? String(sapHistorical.suggested_discharge_port)
        : null,
      suggested_loading_port: sapHistorical.suggested_loading_port
        ? String(sapHistorical.suggested_loading_port)
        : null,
      source: 'SAP_HISTORICAL' as const,
    };
    await upsertVesselPattern(dims, payload);
    return enrichVesselResultWithCharterType(dims, { ...payload, cached: false });
  }

  const sapProcessedHistorical = await findSapProcessedHistoricalVessel(dims);
  if (sapProcessedHistorical?.suggested_vessel_name) {
    const payload = mapSapProcessedVesselRow(sapProcessedHistorical);
    await upsertVesselPattern(dims, payload);
    return enrichVesselResultWithCharterType(dims, { ...payload, cached: false });
  }

  const sapSegments = await fetchSapSegmentsForVessel(dims);
  const claudePayload = {
    task: 'suggest_vessel',
    dimensions: dims,
    historical_klip_segments: sapSegments,
    notes: [
      'Charter type is not in SAP Data; use charter_type from Klip shipment history in segments when present.',
      'Allowed charter_type values: CIF, V/C, T/C.',
      'When the exact supplier has no vessel history, prefer the most common vessel for the same buyer and product in the segments.',
    ],
    output_schema: {
      suggested_vessel_name: 'string',
      suggested_charter_type: 'CIF | V/C | T/C | null',
      suggested_discharge_port: 'string | null',
      suggested_loading_port: 'string | null',
    },
  };

  const claudeJson = await callClaudeForJson({
    systemPrompt: KLIP_LOGISTICS_SYSTEM_PROMPT,
    userPrompt: JSON.stringify(claudePayload),
  });

  const suggested_vessel_name = String(
    claudeJson.suggested_vessel_name ?? claudeJson.vessel_name ?? '',
  ).trim();
  if (!suggested_vessel_name) {
    throw new Error('Claude did not return a vessel name suggestion');
  }

  const payload = {
    suggested_vessel_name,
    suggested_charter_type: normalizeCharterType(claudeJson.suggested_charter_type),
    suggested_discharge_port: claudeJson.suggested_discharge_port
      ? String(claudeJson.suggested_discharge_port).trim()
      : null,
    suggested_loading_port: claudeJson.suggested_loading_port
      ? String(claudeJson.suggested_loading_port).trim()
      : null,
    source: 'CLAUDE_AI' as const,
  };

  await upsertVesselPattern(dims, payload);
  return enrichVesselResultWithCharterType(dims, { ...payload, cached: false });
}

function buildEtaMilestones(loadingDate: string, avgTransitDays: number): EtaMilestones {
  const transit = Math.max(1, Math.round(avgTransitDays));
  return {
    etaVesselArrivalAtLoadingPort: loadingDate,
    etaVesselBerthedAtLoadingPort: shiftIsoDate(loadingDate, 0),
    etaVesselStartLoading: shiftIsoDate(loadingDate, 1),
    etaVesselCompletedLoading: shiftIsoDate(loadingDate, 2),
    etaVesselSailedFromLoadingPort: shiftIsoDate(loadingDate, 3),
    etaVesselArriveAtDischargePort: shiftIsoDate(loadingDate, transit),
    etaVesselBerthedAtDischargePort: shiftIsoDate(loadingDate, transit + 1),
    etaVesselStartDischarging: shiftIsoDate(loadingDate, transit + 2),
    etaVesselCompleteDischarge: shiftIsoDate(loadingDate, transit + 4),
  };
}

async function findCachedEtaPattern(route: ReturnType<typeof normalizeRoute>) {
  const result = await query(
    `SELECT *
     FROM eta_patterns
     WHERE vessel_name = $1
       AND loading_port = $2
       AND discharge_port = $3
     LIMIT 1`,
    [route.vessel_name, route.loading_port, route.discharge_port],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function findSapHistoricalTransitDays(route: ReturnType<typeof normalizeRoute>) {
  const result = await query(
    `SELECT
       AVG(
         (COALESCE(s.eta_discharge_arrival, s.ata_discharge_arrival)::date
          - COALESCE(s.eta_arrival, s.ata_arrival)::date)
       )::numeric(8,2) AS avg_transit_days,
       COUNT(*)::int AS sample_size
     FROM shipments s
     WHERE UPPER(TRIM(s.vessel_name)) = UPPER(TRIM($1))
       AND UPPER(TRIM(COALESCE(s.port_of_loading, ''))) = UPPER(TRIM($2))
       AND UPPER(TRIM(COALESCE(s.port_of_discharge, ''))) = UPPER(TRIM($3))
       AND COALESCE(s.eta_discharge_arrival, s.ata_discharge_arrival) IS NOT NULL
       AND COALESCE(s.eta_arrival, s.ata_arrival) IS NOT NULL`,
    [route.vessel_name, route.loading_port, route.discharge_port],
  );
  const row = result.rows[0] as { avg_transit_days?: string | number; sample_size?: number };
  const sampleSize = Number(row?.sample_size ?? 0);
  const avg = Number(row?.avg_transit_days ?? 0);
  if (sampleSize > 0 && Number.isFinite(avg) && avg > 0) {
    return avg;
  }
  return null;
}

async function fetchSapRouteSegments(route: ReturnType<typeof normalizeRoute>) {
  const result = await query(
    `SELECT
       s.vessel_name,
       s.port_of_loading,
       s.port_of_discharge,
       s.eta_arrival,
       s.eta_sailed,
       s.eta_discharge_arrival,
       s.ata_arrival,
       s.ata_sailed,
       s.ata_discharge_arrival
     FROM shipments s
     WHERE UPPER(TRIM(s.vessel_name)) = UPPER(TRIM($1))
       AND (
         UPPER(TRIM(COALESCE(s.port_of_loading, ''))) = UPPER(TRIM($2))
         OR UPPER(TRIM(COALESCE(s.port_of_discharge, ''))) = UPPER(TRIM($3))
       )
     ORDER BY s.updated_at DESC NULLS LAST
     LIMIT 25`,
    [route.vessel_name, route.loading_port, route.discharge_port],
  );
  return result.rows;
}

async function upsertEtaPattern(
  route: ReturnType<typeof normalizeRoute>,
  avgTransitDays: number,
  source: 'SAP_HISTORICAL' | 'CLAUDE_AI',
) {
  await query(
    `INSERT INTO eta_patterns (
       vessel_name, loading_port, discharge_port, avg_transit_days, source, last_updated
     ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (vessel_name, loading_port, discharge_port)
     DO UPDATE SET
       avg_transit_days = EXCLUDED.avg_transit_days,
       source = EXCLUDED.source,
       last_updated = CURRENT_TIMESTAMP`,
    [route.vessel_name, route.loading_port, route.discharge_port, avgTransitDays, source],
  );
}

export async function suggestEtaForShipment(input: EtaSuggestInput): Promise<EtaSuggestResult> {
  const route = normalizeRoute(input);
  if (!route.vessel_name || !route.loading_port || !route.discharge_port) {
    throw new Error('vessel_name, loading_port, and discharge_port are required');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(route.loading_date)) {
    throw new Error('loading_date must be an ISO date (YYYY-MM-DD)');
  }

  const cached = await findCachedEtaPattern(route);
  if (cached?.avg_transit_days != null) {
    const avg = Number(cached.avg_transit_days);
    return {
      avg_transit_days: avg,
      source: cached.source as 'SAP_HISTORICAL' | 'CLAUDE_AI',
      cached: true,
      milestones: buildEtaMilestones(route.loading_date, avg),
    };
  }

  const sapAvg = await findSapHistoricalTransitDays(route);
  if (sapAvg != null) {
    await upsertEtaPattern(route, sapAvg, 'SAP_HISTORICAL');
    return {
      avg_transit_days: sapAvg,
      source: 'SAP_HISTORICAL',
      cached: false,
      milestones: buildEtaMilestones(route.loading_date, sapAvg),
    };
  }

  const sapSegments = await fetchSapRouteSegments(route);
  const claudePayload = {
    task: 'suggest_transit_days',
    route,
    historical_sap_segments: sapSegments,
    output_schema: {
      avg_transit_days: 'number (days from loading port arrival to discharge port arrival)',
    },
  };

  const claudeJson = await callClaudeForJson({
    systemPrompt: KLIP_LOGISTICS_SYSTEM_PROMPT,
    userPrompt: JSON.stringify(claudePayload),
  });

  const avgTransitDays = Number(claudeJson.avg_transit_days ?? claudeJson.transit_days ?? 0);
  if (!Number.isFinite(avgTransitDays) || avgTransitDays <= 0) {
    throw new Error('Claude did not return a valid avg_transit_days value');
  }

  await upsertEtaPattern(route, avgTransitDays, 'CLAUDE_AI');
  return {
    avg_transit_days: avgTransitDays,
    source: 'CLAUDE_AI',
    cached: false,
    milestones: buildEtaMilestones(route.loading_date, avgTransitDays),
  };
}

export async function ensureAiShipmentPatternTables(): Promise<void> {
  try {
    await query('SELECT 1 FROM vessel_patterns LIMIT 1');
  } catch (error) {
    logger.warn('vessel_patterns table missing — run db:migrate for AI Shipment Planner', error);
  }
}
