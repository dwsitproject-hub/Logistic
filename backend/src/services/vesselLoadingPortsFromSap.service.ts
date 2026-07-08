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

function isValidHumanPortName(value: unknown): boolean {
  const text = trimText(value);
  if (!text) return false;
  if (/^\d+(\.\d+)?$/.test(text)) return false;
  return true;
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
    const name = trimText(portName) ?? `Loading Port ${sequence}`;
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
       SELECT s.id, s.shipment_id, s.operation_id, c.contract_id, c.sto_number
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
     SELECT spd.data
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
     ORDER BY spd.created_at DESC NULLS LAST, spd.updated_at DESC NULLS LAST
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

  const merge = (incoming: unknown, current: unknown) =>
    incoming !== null && incoming !== undefined ? incoming : current ?? null;

  const current = existing.rows[0] as Record<string, unknown> | undefined;
  const values = [
    port.port_name,
    port.port_sequence,
    merge(port.quantity_at_loading_port, current?.quantity_at_loading_port),
    merge(port.eta_vessel_arrival, current?.eta_vessel_arrival),
    merge(port.ata_vessel_arrival, current?.ata_vessel_arrival),
    merge(port.eta_vessel_berthed, current?.eta_vessel_berthed),
    merge(port.ata_vessel_berthed, current?.ata_vessel_berthed),
    merge(port.eta_loading_start, current?.eta_loading_start),
    merge(port.ata_loading_start, current?.ata_loading_start),
    merge(port.eta_loading_completed, current?.eta_loading_completed),
    merge(port.ata_loading_completed, current?.ata_loading_completed),
    merge(port.eta_vessel_sailed, current?.eta_vessel_sailed),
    merge(port.ata_vessel_sailed, current?.ata_vessel_sailed),
    merge(port.loading_rate, current?.loading_rate),
    merge(port.quality_ffa, current?.quality_ffa),
    merge(port.quality_mi, current?.quality_mi),
    merge(port.quality_dobi, current?.quality_dobi),
    merge(port.quality_red, current?.quality_red),
    merge(port.quality_ds, current?.quality_ds),
    merge(port.quality_stone, current?.quality_stone),
    port.is_discharge_port === true,
    merge(port.eta_vessel_berthed_at_loading_port, current?.eta_vessel_berthed_at_loading_port),
    merge(port.eta_vessel_arrive_at_discharge_port, current?.eta_vessel_arrive_at_discharge_port),
    merge(port.eta_vessel_berthed_at_discharge_port, current?.eta_vessel_berthed_at_discharge_port),
    merge(port.eta_vessel_start_discharging, current?.eta_vessel_start_discharging),
    merge(port.eta_vessel_complete_discharge, current?.eta_vessel_complete_discharge),
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

/** Sync missing multi-port rows (and ETAs) from latest SAP processed data. */
export async function syncVesselLoadingPortsFromLatestSap(shipmentId: string): Promise<boolean> {
  const plannedPorts = await buildVesselLoadingPortsPlanForShipment(shipmentId);
  if (plannedPorts.length === 0) return false;

  const existing = await query(
    `SELECT port_sequence, port_name, is_discharge_port
     FROM vessel_loading_ports
     WHERE shipment_id = $1::uuid`,
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
  const hasInvalidNames = existingLoading.some((row) => !trimText(row.port_name));
  const plannedNames = plannedLoading.map((row) => normalizePortToken(String(row.port_name ?? '')));
  const existingNames = existingLoading.map((row) => normalizePortToken(String(row.port_name ?? '')));
  const namesMismatch = plannedNames.some((name, index) => existingNames[index] !== name);

  if (plannedLoading.length <= existingLoading.length && !hasInvalidNames && !namesMismatch) {
    return false;
  }

  const client = await getClient();
  try {
    await upsertVesselLoadingPortsFromPlan(client, shipmentId, plannedPorts);
    logger.info('Synced vessel loading ports from SAP', {
      shipmentId,
      sapLoading: plannedLoading.length,
      existingLoading: existingLoading.length,
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
