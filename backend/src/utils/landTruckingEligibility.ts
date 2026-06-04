/**
 * Rules for when SAP upload may create a LAND trucking operation:
 * at least one of: STO No, Trucking Loading / Discharge Location, Trucking Owner,
 * STO Quantity, Quantity Delivery, Quantity Receive (non-zero for quantities).
 * Used by SapDataDistributionService and cleanup scripts.
 */

function str(v: unknown): string {
  if (v == null || v === '') return '';
  return String(v).trim();
}

function hasMeaningfulText(v: unknown): boolean {
  const s = str(v);
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === 'null' || lower === 'n/a' || lower === '-' || lower === '—') return false;
  return true;
}

/** STO number present and not all zeros (e.g. "0", "000"). */
function hasStoNumberValue(v: unknown): boolean {
  const s = str(v);
  if (!s) return false;
  if (/^\s*0+\s*$/.test(s)) return false;
  return true;
}

function hasPositiveNumeric(v: unknown): boolean {
  if (v == null) return false;
  const s = str(v).replace(/,/g, '');
  if (!s) return false;
  const n = parseFloat(s);
  if (Number.isFinite(n)) return n > 0;
  return false;
}

function firstTruckingDatum(parsedData: any): Record<string, unknown> {
  const arr = parsedData?.trucking;
  if (!Array.isArray(arr) || !arr[0]?.data || typeof arr[0].data !== 'object') return {};
  return arr[0].data as Record<string, unknown>;
}

/**
 * True if this contract should be treated as LAND for cleanup (DB transport_mode or latest SPD).
 */
export function isContractLandForTruckingCleanup(
  transportMode: unknown,
  latestSpdData: unknown
): boolean {
  const t = str(transportMode).toUpperCase();
  if (t.startsWith('LAND')) return true;
  if (t.startsWith('SEA')) return false;

  const spd = latestSpdData as any;
  if (!spd || typeof spd !== 'object') return false;
  const c = spd.contract || {};
  const raw = spd.raw || {};
  const seaLand = str(
    c.sea_land || c.transport_mode || raw['Sea / Land'] || raw['sea / land'] || raw['Sea/Land']
  ).toUpperCase();
  if (seaLand.startsWith('LAND')) return true;
  if (seaLand.startsWith('SEA')) return false;
  return false;
}

/**
 * Parsed row shape matches sap_processed_data.data (contract, shipment, raw, trucking[], …).
 */
export function isLandSapRowEligibleForTruckingCreation(parsedData: unknown): boolean {
  const p = parsedData as any;
  if (!p || typeof p !== 'object') return false;

  const contract = p.contract || {};
  const shipment = p.shipment || {};
  const raw = p.raw || {};
  const td = firstTruckingDatum(p);

  const merged: Record<string, unknown> = { ...shipment, ...td };

  const stoNo = merged.sto_no ?? contract.sto_no;

  const truckLoad =
    merged.truck_loading_at_starting_location ??
    merged.truck_loading_at_starting_location_2 ??
    merged.truck_loading_at_discharge_location ??
    merged.vessel_loading_port_1;

  const truckDisc =
    merged.truck_unloading_at_starting_location ??
    merged.truck_unloading_at_starting_location_2 ??
    merged.truck_unloading_at_discharge_location ??
    merged.vessel_discharge_port;

  const owner = merged.trucking_owner_at_starting_location ?? merged.vessel_owner;

  const stoQty = contract.sto_quantity ?? shipment.sto_quantity ?? td.sto_quantity;

  const qtyDel =
    raw['Quantity Delivered'] ??
    raw['Quantity Delivery'] ??
    raw['quantity delivery'] ??
    merged.quantity_delivery;

  const qtyRecv =
    raw['Quantity Receive'] ??
    raw['Qty Receive'] ??
    merged.quantity_delivered_via_trucking ??
    merged.quantity_receive;

  if (hasStoNumberValue(stoNo)) return true;
  if (hasMeaningfulText(truckLoad)) return true;
  if (hasMeaningfulText(truckDisc)) return true;
  if (hasMeaningfulText(owner)) return true;
  if (hasPositiveNumeric(stoQty)) return true;
  if (hasPositiveNumeric(qtyDel)) return true;
  if (hasPositiveNumeric(qtyRecv)) return true;

  return false;
}
