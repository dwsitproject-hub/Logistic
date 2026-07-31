import { PoolClient } from 'pg';
import { getClient, query } from '../database/connection';
import logger from '../utils/logger';

type SapPortRow = Record<string, unknown>;

function trimText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === '0.00') return null;
  return text;
}

function normalizePortToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/^PORT\s+/, '')
    .replace(/\s+/g, ' ');
}

export function extractLoadingPortNamesFromSapData(parsedData: Record<string, unknown>): string[] {
  const names: string[] = [];
  const add = (value: unknown) => {
    const text = trimText(value);
    if (!text) return;
    // Reject Vessel LOA / numeric junk that leaked into vessel_loading_port_* fields.
    if (!isValidHumanPortName(text)) return;
    if (names.some((existing) => normalizePortToken(existing) === normalizePortToken(text))) return;
    names.push(text);
  };

  const raw = (parsedData.raw ?? {}) as Record<string, unknown>;
  const shipment = (parsedData.shipment ?? {}) as Record<string, unknown>;
  add(raw['Vessel Loading Port']);
  add(raw['Vessel Loading Port ']);
  add(raw['Vessel Loading Port 1']);
  add(shipment.vessel_loading_port);
  add(shipment.vessel_loading_port_1);
  add(raw['Vessel Loading Port 2']);
  add(raw['Vessel Loading Port 3']);
  add(shipment.vessel_loading_port_2);
  add(shipment.vessel_loading_port_3);
  return names;
}

export function isValidHumanPortName(value: unknown): boolean {
  const text = trimText(value);
  if (!text) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  return true;
}

/** SAP loading port name for a fixed sequence (1–3); skips numeric SAP port codes. */
export function resolveSapLoadingPortTextBySequence(
  parsedData: Record<string, unknown>,
  sequence: 1 | 2 | 3,
): string | null {
  const raw = (parsedData.raw ?? {}) as Record<string, unknown>;
  const shipment = (parsedData.shipment ?? {}) as Record<string, unknown>;
  const candidates: unknown[] =
    sequence === 1
      ? [
          shipment.vessel_loading_port_1,
          shipment.vessel_loading_port,
          raw['Vessel Loading Port 1'],
          raw['Vessel Loading Port'],
          raw['Vessel Loading Port '],
        ]
      : sequence === 2
        ? [shipment.vessel_loading_port_2, raw['Vessel Loading Port 2']]
        : [shipment.vessel_loading_port_3, raw['Vessel Loading Port 3']];
  for (const candidate of candidates) {
    if (isValidHumanPortName(candidate)) return trimText(candidate);
  }
  return null;
}

export interface SapLoadingPortNameMap {
  bySequence: Map<number, string>;
  discharge: string | null;
}

/** Resolve SAP loading/discharge port labels for a shipment group (all linked SAP rows). */
export async function resolveSapLoadingPortNameMapForShipment(
  shipmentUuid: string,
): Promise<SapLoadingPortNameMap> {
  const stoRows = await resolveAllSapParsedDataForSto(shipmentUuid);
  const bySequence = new Map<number, string>();
  let discharge: string | null = null;
  for (const row of stoRows) {
    for (const seq of [1, 2, 3] as const) {
      if (!bySequence.has(seq)) {
        const name = resolveSapLoadingPortTextBySequence(row.data, seq);
        if (name) bySequence.set(seq, name);
      }
    }
    if (!discharge) {
      discharge = resolvePrimarySapDischargePortText(row.data);
    }
  }
  return { bySequence, discharge };
}

/** Primary SAP loading port text for denormalizing onto shipments.port_of_loading. */
export function resolvePrimarySapLoadingPortText(parsedData: Record<string, unknown>): string | null {
  for (const name of extractLoadingPortNamesFromSapData(parsedData)) {
    if (isValidHumanPortName(name)) return name;
  }
  return null;
}

/** Primary SAP discharge port text for denormalizing onto shipments.port_of_discharge. */
export function resolvePrimarySapDischargePortText(parsedData: Record<string, unknown>): string | null {
  const shipment = (parsedData.shipment ?? {}) as Record<string, unknown>;
  const raw = (parsedData.raw ?? {}) as Record<string, unknown>;
  const candidates = [
    shipment.vessel_discharge_port,
    shipment.port_of_discharge,
    shipment.discharge_port,
    raw['Vessel Discharge Port'],
    raw['Vessel Discharge Port '],
    raw['Port of Discharge'],
  ];
  for (const candidate of candidates) {
    if (isValidHumanPortName(candidate)) return trimText(candidate);
  }
  return null;
}

/**
 * Copy SAP / VLP port names onto shipment shell columns so list shell rows
 * can display ports without waiting for SAP agg hydration (same pattern as discharge).
 */
export async function denormalizeShipmentPortsFromSap(
  client: PoolClient,
  shipmentId: string,
  parsedData: Record<string, unknown>,
  options?: { protectKlip?: boolean },
): Promise<void> {
  if (!shipmentId?.trim()) return;

  let loadingPort = resolvePrimarySapLoadingPortText(parsedData);
  const dischargePort = resolvePrimarySapDischargePortText(parsedData);

  if (!loadingPort) {
    const vlpRes = await client.query<{ port_name: string | null }>(
      `SELECT port_name
       FROM vessel_loading_ports
       WHERE shipment_id = $1::uuid
         AND COALESCE(is_discharge_port, false) = false
       ORDER BY port_sequence ASC NULLS LAST
       LIMIT 1`,
      [shipmentId],
    );
    loadingPort = trimText(vlpRes.rows[0]?.port_name);
  }

  if (!loadingPort && !dischargePort) return;

  const protectKlip = options?.protectKlip === true;
  if (protectKlip) {
    await client.query(
      `UPDATE shipments SET
        port_of_loading = COALESCE(
          NULLIF(NULLIF(TRIM(port_of_loading), ''), '0.00'),
          $2
        ),
        port_of_discharge = COALESCE(
          NULLIF(NULLIF(TRIM(port_of_discharge), ''), '0.00'),
          $3
        ),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1::uuid`,
      [shipmentId, loadingPort, dischargePort],
    );
    return;
  }

  await client.query(
    `UPDATE shipments SET
      port_of_loading = COALESCE(
        $2,
        NULLIF(NULLIF(TRIM(port_of_loading), ''), '0.00')
      ),
      port_of_discharge = COALESCE(
        $3,
        NULLIF(NULLIF(TRIM(port_of_discharge), ''), '0.00')
      ),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1::uuid`,
    [shipmentId, loadingPort, dischargePort],
  );
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const cleaned = typeof value === 'string' ? value.replace(/[,\s]/g, '') : value;
    const num = parseFloat(String(cleaned));
    return Number.isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  try {
    if (typeof value === 'string') {
      const mdYMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (mdYMatch) {
        const m = parseInt(mdYMatch[1], 10);
        const d = parseInt(mdYMatch[2], 10);
        let y = parseInt(mdYMatch[3], 10);
        if (mdYMatch[3].length === 2) y = 2000 + y;
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          return new Date(Date.UTC(y, m - 1, d)).toISOString().split('T')[0];
        }
      }
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function mapQualityColumns(
  qualityByLocation: Map<string, Record<string, unknown>>,
  location: string,
): Record<string, number | null> {
  const qualityData = qualityByLocation.get(location);
  const mapped: Record<string, number | null> = {};
  if (!qualityData) return mapped;

  for (const [key, rawValue] of Object.entries(qualityData)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes('ffa')) mapped.quality_ffa = parseNumber(rawValue);
    else if (normalizedKey.includes('m_i') || normalizedKey.includes('mi') || normalizedKey.includes('moisture')) {
      mapped.quality_mi = parseNumber(rawValue);
    } else if (normalizedKey.includes('dobi')) mapped.quality_dobi = parseNumber(rawValue);
    else if (normalizedKey.includes('red')) mapped.quality_red = parseNumber(rawValue);
    else if (normalizedKey.includes('d_s') || normalizedKey.includes('d&s') || normalizedKey.includes('ds')) {
      mapped.quality_ds = parseNumber(rawValue);
    } else if (normalizedKey.includes('stone')) mapped.quality_stone = parseNumber(rawValue);
  }
  return mapped;
}

export function buildVesselLoadingPortsFromSapParsedData(parsedData: Record<string, unknown>): SapPortRow[] {
  const shipmentData = (parsedData.shipment ?? {}) as Record<string, unknown>;
  const qualityByLocation = new Map<string, Record<string, unknown>>();
  if (Array.isArray(parsedData.quality)) {
    for (const qualityItem of parsedData.quality as Array<{ location?: string; data?: Record<string, unknown> }>) {
      if (!qualityItem?.location) continue;
      qualityByLocation.set(qualityItem.location, qualityItem.data ?? {});
    }
  }

  const loadingPorts: SapPortRow[] = [];

  const pushLoadingPort = (
    sequence: 1 | 2 | 3,
    portName: unknown,
    qtyKey: string,
    qualityLocation: string,
    eta: Record<string, unknown>,
  ) => {
    const name = (isValidHumanPortName(portName) ? trimText(portName) : null) ?? `Loading Port ${sequence}`;
    const etaBerthed = parseDate(eta.berthed);
    loadingPorts.push({
      port_name: name,
      port_sequence: sequence,
      quantity_at_loading_port: parseNumber(shipmentData[qtyKey]),
      eta_vessel_arrival: parseDate(eta.arrival),
      ata_vessel_arrival: parseDate(eta.ataArrival),
      eta_vessel_berthed: etaBerthed,
      ata_vessel_berthed: parseDate(eta.ataBerthed),
      eta_vessel_berthed_at_loading_port: etaBerthed,
      eta_loading_start: parseDate(eta.start),
      ata_loading_start: parseDate(eta.ataStart),
      eta_loading_completed: parseDate(eta.completed),
      ata_loading_completed: parseDate(eta.ataCompleted),
      eta_vessel_sailed: parseDate(eta.sailed),
      ata_vessel_sailed: parseDate(eta.ataSailed),
      loading_rate: parseNumber(eta.rate),
      is_discharge_port: false,
      eta_vessel_arrive_at_discharge_port: null,
      eta_vessel_berthed_at_discharge_port: null,
      eta_vessel_start_discharging: null,
      eta_vessel_complete_discharge: null,
      ...mapQualityColumns(qualityByLocation, qualityLocation),
    });
  };

  if (
    trimText(shipmentData.vessel_loading_port_1) ||
    trimText((parsedData.raw as Record<string, unknown> | undefined)?.['Vessel Loading Port']) ||
    shipmentData.quantity_at_loading_port_1_based_on_bast ||
    qualityByLocation.has('Loading Port 1')
  ) {
    const port1Name =
      trimText(shipmentData.vessel_loading_port_1) ??
      trimText((parsedData.raw as Record<string, unknown> | undefined)?.['Vessel Loading Port']);
    pushLoadingPort(1, port1Name, 'quantity_at_loading_port_1_based_on_bast', 'Loading Port 1', {
      arrival:
        shipmentData.eta_vessel_arrival_loading_port_1 ??
        shipmentData.eta_vessel_arrival_at_loading_port_1,
      ataArrival: shipmentData.ata_vessel_arrival_at_loading_port_1,
      berthed: shipmentData.eta_vessel_berthed_at_loading_port_1,
      ataBerthed: shipmentData.ata_vessel_berthed_at_loading_port_1,
      start: shipmentData.eta_loading_start_at_loading_port_1,
      ataStart: shipmentData.ata_loading_start_at_loading_port_1 ?? shipmentData.ata_vessel_start_loading,
      completed: shipmentData.eta_loading_completed_at_loading_port_1,
      ataCompleted:
        shipmentData.ata_loading_completed_at_loading_port_1 ?? shipmentData.ata_vessel_completed_loading,
      sailed: shipmentData.eta_vessel_sailed_at_loading_port_1,
      ataSailed:
        shipmentData.ata_vessel_sailed_at_loading_port_1 ?? shipmentData.ata_vessel_sailed_from_loading_port,
      rate: shipmentData.loading_rate_at_loading_port_1,
    });
  }

  if (
    trimText(shipmentData.vessel_loading_port_2) ||
    shipmentData.quantity_at_loading_port_2 ||
    qualityByLocation.has('Loading Port 2')
  ) {
    pushLoadingPort(2, shipmentData.vessel_loading_port_2, 'quantity_at_loading_port_2', 'Loading Port 2', {
      arrival: shipmentData.eta_vessel_arrival_at_loading_port_2,
      ataArrival: shipmentData.ata_vessel_arrival_at_loading_port_2,
      berthed: shipmentData.eta_vessel_berthed_at_loading_port_2,
      ataBerthed: shipmentData.ata_vessel_berthed_at_loading_port_2,
      start: shipmentData.eta_loading_start_at_loading_port_2,
      ataStart: shipmentData.ata_loading_start_at_loading_port_2,
      completed: shipmentData.eta_loading_completed_at_loading_port_2,
      ataCompleted: shipmentData.ata_loading_completed_at_loading_port_2,
      sailed: shipmentData.eta_vessel_sailed_at_loading_port_2,
      ataSailed: shipmentData.ata_vessel_sailed_at_loading_port_2,
      rate: shipmentData.loading_rate_at_loading_port_2,
    });
  }

  if (
    trimText(shipmentData.vessel_loading_port_3) ||
    shipmentData.quantity_at_loading_port_3 ||
    qualityByLocation.has('Loading Port 3')
  ) {
    pushLoadingPort(3, shipmentData.vessel_loading_port_3, 'quantity_at_loading_port_3', 'Loading Port 3', {
      arrival: shipmentData.eta_vessel_arrival_at_loading_port_3,
      ataArrival: shipmentData.ata_vessel_arrival_at_loading_port_3,
      berthed: shipmentData.eta_vessel_berthed_at_loading_port_3,
      ataBerthed: shipmentData.ata_vessel_berthed_at_loading_port_3,
      start: shipmentData.eta_loading_start_at_loading_port_3,
      ataStart: shipmentData.ata_loading_start_at_loading_port_3,
      completed: shipmentData.eta_loading_completed_at_loading_port_3,
      ataCompleted: shipmentData.ata_loading_completed_at_loading_port_3,
      sailed: shipmentData.eta_vessel_sailed_at_loading_port_3,
      ataSailed: shipmentData.ata_vessel_sailed_at_loading_port_3,
      rate: shipmentData.loading_rate_at_loading_port_3,
    });
  }

  const dischargeQuality = mapQualityColumns(qualityByLocation, 'Discharge Port');
  const dischargePortName =
    trimText(shipmentData.vessel_discharge_port) ?? trimText(shipmentData.port_of_discharge);
  if (dischargePortName || Object.keys(dischargeQuality).length > 0) {
    const etaArrival = parseDate(shipmentData.eta_arrival_at_discharge_port);
    const etaBerthed = parseDate(shipmentData.eta_vessel_berthed_at_discharge_port);
    const etaStart = parseDate(shipmentData.eta_discharging_start_at_discharge_port);
    const etaComplete = parseDate(shipmentData.eta_discharging_completed_at_discharge_port);
    loadingPorts.push({
      port_name: dischargePortName ?? 'Discharge Port',
      port_sequence: 999,
      quantity_at_loading_port: parseNumber(
        shipmentData.actual_vessel_qty_receive ?? shipmentData.quantity_delivered,
      ),
      eta_vessel_arrival: etaArrival,
      ata_vessel_arrival: parseDate(shipmentData.ata_vessel_arrival_at_discharge_port),
      eta_vessel_berthed: etaBerthed,
      ata_vessel_berthed: parseDate(shipmentData.ata_vessel_berthed_at_discharge_port),
      eta_loading_start: etaStart,
      ata_loading_start:
        parseDate(shipmentData.ata_discharging_start_at_discharge_port) ??
        parseDate(shipmentData.ata_vessel_start_discharging),
      eta_loading_completed: etaComplete,
      ata_loading_completed:
        parseDate(shipmentData.ata_discharging_completed_at_discharge_port) ??
        parseDate(shipmentData.ata_vessel_completed_discharge),
      eta_vessel_sailed: etaComplete,
      ata_vessel_sailed:
        parseDate(shipmentData.ata_discharging_completed_at_discharge_port) ??
        parseDate(shipmentData.ata_vessel_completed_discharge),
      loading_rate: parseNumber(shipmentData.discharge_rate_at_discharging_port),
      is_discharge_port: true,
      eta_vessel_berthed_at_loading_port: null,
      eta_vessel_arrive_at_discharge_port: etaArrival,
      eta_vessel_berthed_at_discharge_port: etaBerthed,
      eta_vessel_start_discharging: etaStart,
      eta_vessel_complete_discharge: etaComplete,
      ...dischargeQuality,
    });
  }

  return loadingPorts;
}

export function sapParsedDataHasMultipleLoadingPorts(parsedData: Record<string, unknown>): boolean {
  const ports = buildVesselLoadingPortsFromSapParsedData(parsedData);
  return ports.filter((p) => p.is_discharge_port !== true).length > 1;
}

async function resolveAllSapParsedDataForSto(
  shipmentId: string,
): Promise<Array<{ data: Record<string, unknown> }>> {
  const result = await query(
    `WITH ship AS (
       SELECT
         s.id,
         s.shipment_id,
         s.operation_id,
         c.contract_id,
         c.sto_number,
         -- Manual planning keys like OP-1004030966-10390582 embed the SAP STO after OP-
         NULLIF((regexp_match(TRIM(COALESCE(s.operation_id::text, '')), '^OP-([0-9]+)'))[1], '') AS op_embedded_sto
       FROM shipments s
       LEFT JOIN contracts c ON c.id = s.contract_id
       WHERE s.id = $1::uuid
     )
     SELECT spd.data
     FROM sap_processed_data spd
     CROSS JOIN ship sh
     WHERE (
       NULLIF(TRIM(spd.sto_number::text), '') IS NOT NULL AND (
         TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.sto_number::text), '')
         OR TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.shipment_id::text), '')
         OR TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.operation_id::text), '')
         OR TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.op_embedded_sto::text), '')
       )
     )
     ORDER BY spd.contract_number ASC NULLS LAST, spd.updated_at DESC NULLS LAST`,
    [shipmentId],
  );
  return result.rows
    .map((row) => row.data)
    .filter((data): data is Record<string, unknown> => Boolean(data) && typeof data === 'object')
    .map((data) => ({ data }));
}

async function resolveMasterPortDisplayName(sapPortName: string): Promise<string> {
  const token = normalizePortToken(sapPortName);
  if (!token) return sapPortName;
  const match = await query(
    `SELECT port
     FROM master_loading_ports
     WHERE UPPER(REPLACE(port, ' ', '')) LIKE '%' || REPLACE($1, ' ', '') || '%'
        OR REPLACE($1, ' ', '') LIKE '%' || UPPER(REPLACE(port, ' ', '')) || '%'
     ORDER BY LENGTH(port) ASC
     LIMIT 1`,
    [token],
  );
  return trimText(match.rows[0]?.port) ?? sapPortName;
}

function findSapRowForPortName(
  rows: Array<{ data: Record<string, unknown> }>,
  portName: string,
): { data: Record<string, unknown> } | undefined {
  const target = normalizePortToken(portName);
  return rows.find((row) =>
    extractLoadingPortNamesFromSapData(row.data).some(
      (name) => normalizePortToken(name) === target,
    ),
  );
}

function emptyLoadingPortRow(sequence: number, portName: string): SapPortRow {
  return {
    port_name: portName,
    port_sequence: sequence,
    quantity_at_loading_port: null,
    eta_vessel_arrival: null,
    ata_vessel_arrival: null,
    eta_vessel_berthed: null,
    ata_vessel_berthed: null,
    eta_vessel_berthed_at_loading_port: null,
    eta_loading_start: null,
    ata_loading_start: null,
    eta_loading_completed: null,
    ata_loading_completed: null,
    eta_vessel_sailed: null,
    ata_vessel_sailed: null,
    loading_rate: null,
    is_discharge_port: false,
    eta_vessel_arrive_at_discharge_port: null,
    eta_vessel_berthed_at_discharge_port: null,
    eta_vessel_start_discharging: null,
    eta_vessel_complete_discharge: null,
  };
}

export async function buildVesselLoadingPortsPlanForShipment(
  shipmentId: string,
): Promise<SapPortRow[]> {
  const latest = await resolveLatestSapParsedDataForShipment(shipmentId);
  if (!latest) return [];

  const classic = buildVesselLoadingPortsFromSapParsedData(latest);
  const classicLoading = classic.filter((p) => p.is_discharge_port !== true);
  const discharge = classic.find((p) => p.is_discharge_port === true);

  if (classicLoading.length > 1) return classic;

  const stoRows = await resolveAllSapParsedDataForSto(shipmentId);
  const portCounts = new Map<string, number>();
  const distinctRaw: string[] = [];
  for (const row of stoRows) {
    for (const name of extractLoadingPortNamesFromSapData(row.data)) {
      const token = normalizePortToken(name);
      portCounts.set(token, (portCounts.get(token) ?? 0) + 1);
      if (!distinctRaw.some((existing) => normalizePortToken(existing) === token)) {
        distinctRaw.push(name);
      }
    }
  }
  distinctRaw.sort(
    (a, b) =>
      (portCounts.get(normalizePortToken(b)) ?? 0) - (portCounts.get(normalizePortToken(a)) ?? 0),
  );

  if (distinctRaw.length > 1) {
    const loadingPorts: SapPortRow[] = [];
    for (let i = 0; i < distinctRaw.length; i += 1) {
      const displayName = await resolveMasterPortDisplayName(distinctRaw[i]);
      const matchRow = findSapRowForPortName(stoRows, distinctRaw[i]);
      const matchClassic = matchRow
        ? buildVesselLoadingPortsFromSapParsedData(matchRow.data).find((p) => p.is_discharge_port !== true)
        : undefined;
      const base = matchClassic ?? (i === 0 ? classicLoading[0] : undefined);
      loadingPorts.push({
        ...emptyLoadingPortRow(i + 1, displayName),
        ...(base ?? {}),
        port_name: displayName,
        port_sequence: i + 1,
        is_discharge_port: false,
      });
    }
    if (discharge) loadingPorts.push(discharge);
    return loadingPorts;
  }

  if (classicLoading.length === 1 && distinctRaw.length === 1) {
    classicLoading[0].port_name = await resolveMasterPortDisplayName(distinctRaw[0]);
  } else if (classicLoading.length === 1 && !trimText(classicLoading[0].port_name) && distinctRaw[0]) {
    classicLoading[0].port_name = await resolveMasterPortDisplayName(distinctRaw[0]);
  }

  return classic;
}

async function resolveLatestSapParsedDataForShipment(
  shipmentId: string,
): Promise<Record<string, unknown> | null> {
  const result = await query(
    `WITH ship AS (
       SELECT s.id, s.shipment_id, s.operation_id, c.contract_id, c.sto_number
       FROM shipments s
       LEFT JOIN contracts c ON c.id = s.contract_id
       WHERE s.id = $1::uuid
     )
     SELECT
       spd.data,
       /*
        * Rank an exact STO match ahead of the contract-wide fallback.
        *
        * A contract can carry many STOs, each with its own SAP row. Ordering purely by
        * created_at let a NEWER SIBLING STO of the same contract outrank the shipment's own
        * STO, so the shipment inherited that sibling's vessel and quality values — e.g. STO
        * 1016010973 showed FFA 0.000 because sibling 1016010976 was imported a day later,
        * while SAP reported FFA 4.841 for 1016010973 itself.
        *
        * The fallback is kept for shipments that carry no usable STO reference at all; it is
        * just no longer allowed to beat a direct hit.
        */
       CASE
         WHEN NULLIF(TRIM(spd.sto_number::text), '') IS NOT NULL AND (
           TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.sto_number::text), '')
           OR TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.shipment_id::text), '')
           OR TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.operation_id::text), '')
         ) THEN 0
         ELSE 1
       END AS sto_match_rank
     FROM sap_processed_data spd
     CROSS JOIN ship sh
     WHERE (
       NULLIF(TRIM(spd.sto_number::text), '') IS NOT NULL AND (
         TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.sto_number::text), '')
         OR TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.shipment_id::text), '')
         OR TRIM(spd.sto_number::text) = NULLIF(TRIM(sh.operation_id::text), '')
       )
       OR (sh.contract_id IS NOT NULL AND spd.contract_number = sh.contract_id)
     )
     ORDER BY sto_match_rank ASC, spd.created_at DESC NULLS LAST, spd.updated_at DESC NULLS LAST
     LIMIT 1`,
    [shipmentId],
  );
  const data = result.rows[0]?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

async function upsertVesselLoadingPortRow(
  client: PoolClient,
  shipmentId: string,
  port: SapPortRow,
): Promise<void> {
  if (!trimText(port.port_name)) return;

  const existing = await client.query(
    `SELECT *
     FROM vessel_loading_ports
     WHERE shipment_id = $1
       AND port_sequence = $2
       AND COALESCE(is_discharge_port, false) = $3
     LIMIT 1`,
    [shipmentId, port.port_sequence, port.is_discharge_port === true],
  );

  const current = existing.rows[0] as Record<string, unknown> | undefined;
  const values = [
    port.port_name,
    port.port_sequence,
    mergeSapPortValue(port.quantity_at_loading_port, current?.quantity_at_loading_port),
    mergeSapPortValue(port.eta_vessel_arrival, current?.eta_vessel_arrival),
    mergeSapPortValue(port.ata_vessel_arrival, current?.ata_vessel_arrival),
    mergeSapPortValue(port.eta_vessel_berthed, current?.eta_vessel_berthed),
    mergeSapPortValue(port.ata_vessel_berthed, current?.ata_vessel_berthed),
    mergeSapPortValue(port.eta_loading_start, current?.eta_loading_start),
    mergeSapPortValue(port.ata_loading_start, current?.ata_loading_start),
    mergeSapPortValue(port.eta_loading_completed, current?.eta_loading_completed),
    mergeSapPortValue(port.ata_loading_completed, current?.ata_loading_completed),
    mergeSapPortValue(port.eta_vessel_sailed, current?.eta_vessel_sailed),
    mergeSapPortValue(port.ata_vessel_sailed, current?.ata_vessel_sailed),
    mergeSapPortValue(port.loading_rate, current?.loading_rate),
    mergeSapPortQuality(port.quality_ffa, current?.quality_ffa),
    mergeSapPortQuality(port.quality_mi, current?.quality_mi),
    mergeSapPortQuality(port.quality_dobi, current?.quality_dobi),
    mergeSapPortQuality(port.quality_red, current?.quality_red),
    mergeSapPortQuality(port.quality_ds, current?.quality_ds),
    mergeSapPortQuality(port.quality_stone, current?.quality_stone),
    port.is_discharge_port === true,
    mergeSapPortValue(port.eta_vessel_berthed_at_loading_port, current?.eta_vessel_berthed_at_loading_port),
    mergeSapPortValue(port.eta_vessel_arrive_at_discharge_port, current?.eta_vessel_arrive_at_discharge_port),
    mergeSapPortValue(port.eta_vessel_berthed_at_discharge_port, current?.eta_vessel_berthed_at_discharge_port),
    mergeSapPortValue(port.eta_vessel_start_discharging, current?.eta_vessel_start_discharging),
    mergeSapPortValue(port.eta_vessel_complete_discharge, current?.eta_vessel_complete_discharge),
  ];

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE vessel_loading_ports SET
         port_name = $2,
         port_sequence = $3,
         quantity_at_loading_port = $4::numeric,
         eta_vessel_arrival = $5::timestamp,
         ata_vessel_arrival = $6::timestamp,
         eta_vessel_berthed = $7::timestamp,
         ata_vessel_berthed = $8::timestamp,
         eta_loading_start = $9::timestamp,
         ata_loading_start = $10::timestamp,
         eta_loading_completed = $11::timestamp,
         ata_loading_completed = $12::timestamp,
         eta_vessel_sailed = $13::timestamp,
         ata_vessel_sailed = $14::timestamp,
         loading_rate = $15::numeric,
         quality_ffa = $16::numeric,
         quality_mi = $17::numeric,
         quality_dobi = $18::numeric,
         quality_red = $19::numeric,
         quality_ds = $20::numeric,
         quality_stone = $21::numeric,
         is_discharge_port = $22::boolean,
         eta_vessel_berthed_at_loading_port = $23::timestamp,
         eta_vessel_arrive_at_discharge_port = $24::timestamp,
         eta_vessel_berthed_at_discharge_port = $25::timestamp,
         eta_vessel_start_discharging = $26::timestamp,
         eta_vessel_complete_discharge = $27::timestamp,
         is_cancelled = false,
         cancel_remark = NULL,
         cancelled_at = NULL,
         cancelled_by_user_id = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [existing.rows[0].id, ...values],
    );
    return;
  }

  await client.query(
    `INSERT INTO vessel_loading_ports (
       shipment_id, port_name, port_sequence, quantity_at_loading_port,
       eta_vessel_arrival, ata_vessel_arrival, eta_vessel_berthed, ata_vessel_berthed,
       eta_loading_start, ata_loading_start, eta_loading_completed, ata_loading_completed,
       eta_vessel_sailed, ata_vessel_sailed, loading_rate,
       quality_ffa, quality_mi, quality_dobi, quality_red, quality_ds, quality_stone,
       is_discharge_port,
       eta_vessel_berthed_at_loading_port, eta_vessel_arrive_at_discharge_port,
       eta_vessel_berthed_at_discharge_port, eta_vessel_start_discharging, eta_vessel_complete_discharge
     ) VALUES (
       $1::uuid, $2, $3, $4::numeric,
       $5::timestamp, $6::timestamp, $7::timestamp, $8::timestamp,
       $9::timestamp, $10::timestamp, $11::timestamp, $12::timestamp,
       $13::timestamp, $14::timestamp, $15::numeric,
       $16::numeric, $17::numeric, $18::numeric, $19::numeric, $20::numeric, $21::numeric,
       $22::boolean,
       $23::timestamp, $24::timestamp, $25::timestamp, $26::timestamp, $27::timestamp
     )`,
    [shipmentId, ...values],
  );
}

export async function upsertVesselLoadingPortsFromSapData(
  client: PoolClient,
  shipmentId: string,
  parsedData: Record<string, unknown>,
): Promise<number> {
  const ports = buildVesselLoadingPortsFromSapParsedData(parsedData);
  let upserted = 0;
  for (const port of ports) {
    await upsertVesselLoadingPortRow(client, shipmentId, port);
    upserted += 1;
  }
  return upserted;
}

async function upsertVesselLoadingPortsFromPlan(
  client: PoolClient,
  shipmentId: string,
  ports: SapPortRow[],
): Promise<number> {
  let upserted = 0;
  for (const port of ports) {
    await upsertVesselLoadingPortRow(client, shipmentId, port);
    upserted += 1;
  }
  return upserted;
}

/** Soft-cancel loading ports that are numeric junk (Vessel LOA leak) or extras when SAP has one port. */
async function cancelBogusExtraLoadingPorts(
  shipmentId: string,
  plannedLoading: SapPortRow[],
  existingLoading: Array<{ port_sequence: unknown; port_name: unknown; is_discharge_port?: unknown }>,
): Promise<number> {
  const plannedTokens = new Set(
    plannedLoading
      .map((p) => normalizePortToken(String(p.port_name ?? '')))
      .filter((t) => t.length > 0),
  );
  const sequencesToCancel = existingLoading
    .filter((row) => {
      const name = String(row.port_name ?? '');
      // Always drop Vessel LOA / pure-numeric names.
      if (!isValidHumanPortName(name)) return true;
      // When SAP has exactly one loading port, cancel any extra non-matching rows.
      if (plannedLoading.length !== 1 || existingLoading.length <= 1) return false;
      return !plannedTokens.has(normalizePortToken(name));
    })
    .map((row) => Number(row.port_sequence))
    .filter((seq) => Number.isFinite(seq));

  if (sequencesToCancel.length === 0) return 0;

  const result = await query(
    `UPDATE vessel_loading_ports
     SET is_cancelled = true,
         cancel_remark = COALESCE(NULLIF(TRIM(cancel_remark), ''), $2),
         cancelled_at = COALESCE(cancelled_at, NOW())
     WHERE shipment_id = $1::uuid
       AND COALESCE(is_discharge_port, false) = false
       AND COALESCE(is_cancelled, false) = false
       AND port_sequence = ANY($3::int[])`,
    [
      shipmentId,
      'Auto-cancelled: invalid/numeric port name (e.g. Vessel LOA mis-map)',
      sequencesToCancel,
    ],
  );
  return result.rowCount ?? sequencesToCancel.length;
}

/**
 * Fill gaps only: keep whatever is already stored and take the SAP value only where nothing
 * meaningful is stored yet.
 *
 * Previously this preferred the incoming SAP value, so a sync could overwrite a figure a user
 * had typed. Combined with the structural early-return in the caller, that also meant a value
 * written once from the WRONG sibling STO could never be corrected. Filling gaps fixes the
 * stale zeros without ever clobbering manual input.
 */
export function mergeSapPortValue(incoming: unknown, current: unknown): unknown {
  const hasCurrent =
    current !== null && current !== undefined && !(typeof current === 'string' && current.trim() === '');
  if (hasCurrent) return current;
  return incoming !== null && incoming !== undefined ? incoming : current ?? null;
}

/**
 * Quality-only variant that also treats a stored zero as a gap.
 *
 * SAP reports absent quality readings as 0.000, and that is how the wrong-STO zeros got in.
 * A genuine zero FFA/M&I/DOBI does not occur in practice, so a stored 0 here means "never
 * populated". Deliberately NOT used for quantities or rates, where 0 can be a real entry a
 * user made and must not be overwritten.
 */
export function mergeSapPortQuality(incoming: unknown, current: unknown): unknown {
  const isEmptyish =
    current === null ||
    current === undefined ||
    (typeof current === 'string' && current.trim() === '') ||
    Number(current) === 0;
  if (!isEmptyish) return current;
  return incoming !== null && incoming !== undefined ? incoming : current ?? null;
}

/**
 * Fields the SAP sync may fill on an existing port row, and whether a stored 0 counts as a gap.
 *
 * zeroIsGap is true only for quality readings: SAP writes absent readings as 0.000 and a genuine
 * zero FFA/M&I/DOBI does not occur, so a stored 0 there means "never populated". Quantities and
 * rates keep zeroIsGap false, because 0 can be a deliberate entry that must not be overwritten.
 */
const SAP_FILLABLE_PORT_FIELDS: Array<{ column: string; zeroIsGap: boolean }> = [
  { column: 'quality_ffa', zeroIsGap: true },
  { column: 'quality_mi', zeroIsGap: true },
  { column: 'quality_dobi', zeroIsGap: true },
  { column: 'quality_red', zeroIsGap: true },
  { column: 'quality_ds', zeroIsGap: true },
  { column: 'quality_stone', zeroIsGap: true },
  { column: 'quantity_at_loading_port', zeroIsGap: false },
  { column: 'loading_rate', zeroIsGap: false },
  { column: 'eta_vessel_arrival', zeroIsGap: false },
  { column: 'ata_vessel_arrival', zeroIsGap: false },
  { column: 'eta_vessel_berthed', zeroIsGap: false },
  { column: 'ata_vessel_berthed', zeroIsGap: false },
  { column: 'eta_loading_start', zeroIsGap: false },
  { column: 'ata_loading_start', zeroIsGap: false },
  { column: 'eta_loading_completed', zeroIsGap: false },
  { column: 'ata_loading_completed', zeroIsGap: false },
  { column: 'eta_vessel_sailed', zeroIsGap: false },
  { column: 'ata_vessel_sailed', zeroIsGap: false },
];

/** Sync missing multi-port rows (and ETAs) from latest SAP processed data. */
export async function syncVesselLoadingPortsFromLatestSap(shipmentId: string): Promise<boolean> {
  const plannedPorts = await buildVesselLoadingPortsPlanForShipment(shipmentId);
  if (plannedPorts.length === 0) return false;

  const existing = await query(
    `SELECT *
     FROM vessel_loading_ports
     WHERE shipment_id = $1::uuid
       AND COALESCE(is_cancelled, false) = false`,
    [shipmentId],
  );
  const existingLoading = existing.rows
    .filter((r) => !r.is_discharge_port)
    .slice()
    .sort((a, b) => Number(a.port_sequence ?? 0) - Number(b.port_sequence ?? 0));
  const plannedLoading = plannedPorts
    .filter((p) => p.is_discharge_port !== true)
    .slice()
    .sort((a, b) => Number(a.port_sequence ?? 0) - Number(b.port_sequence ?? 0));

  const cancelledCount = await cancelBogusExtraLoadingPorts(
    shipmentId,
    plannedLoading,
    existingLoading,
  );

  const activeAfterCancel = existingLoading.filter((row) => {
    const name = String(row.port_name ?? '');
    if (!isValidHumanPortName(name)) return false;
    const plannedTokens = new Set(
      plannedLoading.map((p) => normalizePortToken(String(p.port_name ?? ''))).filter(Boolean),
    );
    if (
      plannedLoading.length === 1 &&
      existingLoading.length > 1 &&
      plannedTokens.size > 0 &&
      !plannedTokens.has(normalizePortToken(name))
    ) {
      return false;
    }
    return true;
  });

  const hasInvalidNames = activeAfterCancel.some((row) => !trimText(row.port_name));
  const plannedNames = plannedLoading.map((row) => normalizePortToken(String(row.port_name ?? '')));
  const existingNames = activeAfterCancel.map((row) => normalizePortToken(String(row.port_name ?? '')));
  const namesMismatch = plannedNames.some((name, index) => existingNames[index] !== name);

  /*
   * The checks above are all STRUCTURAL — port count, names, cancellations. On their own they let
   * the sync return early whenever the shape already matches, which meant a value stored once from
   * the wrong sibling STO was never corrected: SAP reported FFA 4.841 for an STO whose row sat at
   * 0.00 forever. Also look for values SAP can fill, so a shape-identical row still gets repaired.
   */
  const hasFillableValueGap = plannedPorts.some((plannedPort) => {
    const match = existing.rows.find(
      (row: Record<string, unknown>) =>
        Number(row.port_sequence ?? 0) === Number(plannedPort.port_sequence ?? 0) &&
        Boolean(row.is_discharge_port) === (plannedPort.is_discharge_port === true),
    );
    if (!match) return false;
    return SAP_FILLABLE_PORT_FIELDS.some(({ column, zeroIsGap }) => {
      const incoming = plannedPort[column];
      if (incoming === null || incoming === undefined) return false;
      const current = match[column];
      const empty =
        current === null ||
        current === undefined ||
        (typeof current === 'string' && current.trim() === '') ||
        (zeroIsGap && Number(current) === 0);
      // Only a real incoming value can fill a gap; SAP's own 0.000 placeholder must not.
      return empty && !(zeroIsGap && Number(incoming) === 0);
    });
  });

  if (
    cancelledCount === 0 &&
    plannedLoading.length <= activeAfterCancel.length &&
    !hasInvalidNames &&
    !namesMismatch &&
    !hasFillableValueGap
  ) {
    return false;
  }

  const client = await getClient();
  try {
    await upsertVesselLoadingPortsFromPlan(client, shipmentId, plannedPorts);
    logger.info('Synced vessel loading ports from SAP', {
      shipmentId,
      sapLoading: plannedLoading.length,
      existingLoading: existingLoading.length,
      cancelledBogus: cancelledCount,
      hasInvalidNames,
    });
    return true;
  } catch (error) {
    logger.warn('syncVesselLoadingPortsFromLatestSap failed', { shipmentId, error });
    throw error;
  } finally {
    client.release();
  }
}
