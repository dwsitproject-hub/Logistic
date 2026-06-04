/**
 * Rules for when SAP upload may create a SEA shipment:
 * at least one of the following fields has a meaningful value:
 * - STO No
 * - Port of Loading / Port of Discharge
 * - Vessel (name/code/owner/voyage)
 * - STO Quantity
 * - Quantity Delivery / Quantity Receive
 * - ATA milestones (loading + discharge)
 *
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
  // Some SAP exports use "0.00" placeholders for text columns (ports, vessel fields).
  if (/^\s*0+(\.0+)?\s*$/.test(s)) return false;
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

/**
 * Parsed row shape matches sap_processed_data.data (contract, shipment, raw, trucking[], …).
 * The fields below mirror the user's business rule list.
 */
export function isSeaSapRowEligibleForShipmentCreation(parsedData: unknown): boolean {
  const p = parsedData as any;
  if (!p || typeof p !== 'object') return false;

  const contract = p.contract || {};
  const shipment = p.shipment || {};
  const raw = p.raw || {};

  // 1) STO No
  const stoNo = shipment.sto_no ?? shipment.shipment_id ?? contract.sto_no;
  if (hasStoNumberValue(stoNo)) return true;

  // 2) Ports
  const portLoading =
    shipment.vessel_loading_port_1 ??
    shipment.port_of_loading ??
    raw['Port of loading'] ??
    raw['Port of Loading'] ??
    raw['port of loading'];
  if (hasMeaningfulText(portLoading)) return true;

  const portDischarge =
    shipment.vessel_discharge_port ??
    shipment.port_of_discharge ??
    raw['Port of discharge'] ??
    raw['Port of Discharge'] ??
    raw['port of discharge'];
  if (hasMeaningfulText(portDischarge)) return true;

  // 3) Vessel
  const vesselName = shipment.vessel_name ?? raw['Vessel'] ?? raw['Vessel Name'];
  const vesselCode = shipment.vessel_code ?? raw['Vessel Code'];
  const vesselOwner = shipment.vessel_owner ?? raw['Vessel Owner'];
  const voyageNo = shipment.voyage_no ?? raw['Voyage No'] ?? raw['Voyage'];
  if (
    hasMeaningfulText(vesselName) ||
    hasMeaningfulText(vesselCode) ||
    hasMeaningfulText(vesselOwner) ||
    hasMeaningfulText(voyageNo)
  ) {
    return true;
  }

  // 4) STO Quantity
  const stoQty = contract.sto_quantity ?? shipment.sto_quantity ?? raw['STO Quantity'];
  if (hasPositiveNumeric(stoQty)) return true;

  // 5) Quantity Delivery / Receive
  const qtyDelivery =
    raw['Quantity Delivery'] ??
    raw['quantity delivery'] ??
    shipment.quantity_delivery ??
    shipment.quantity_delivered;
  if (hasPositiveNumeric(qtyDelivery)) return true;

  const qtyReceive =
    raw['Quantity Receive'] ??
    raw['Qty Receive'] ??
    shipment.quantity_receive ??
    shipment.actual_vessel_qty_receive;
  if (hasPositiveNumeric(qtyReceive)) return true;

  // 6) ATA milestones (loading + discharge)
  const ataFields = [
    // Loading port ATA
    shipment.ata_vessel_arrival_at_loading_port_1 ?? raw['ATA Vessel Arrival at Loading Port'],
    shipment.ata_vessel_berthed_at_loading_port_1 ?? raw['ATA Vessel Berthed at Loading Port'],
    shipment.ata_vessel_start_loading ?? raw['ATA Vessel Start Loading'],
    shipment.ata_vessel_completed_loading ?? raw['ATA Vessel Completed Loading'],
    shipment.ata_vessel_sailed_at_loading_port_1 ??
      shipment.ata_vessel_sailed_from_loading_port ??
      raw['ATA Vessel Sailed from Loading Port'],
    // Discharge port ATA
    shipment.ata_vessel_arrival_at_discharge_port ?? raw['ATA Vessel Arrive at Discharge Port'],
    shipment.ata_vessel_berthed_at_discharge_port ?? raw['ATA Vessel Berthed at Discharge Port'],
    shipment.ata_vessel_start_discharging ?? raw['ATA Vessel Start Discharging'],
    shipment.ata_vessel_completed_discharge ??
      shipment.ata_discharging_completed_at_discharge_port ??
      raw['ATA Vessel Complete Discharge'],
  ];
  if (ataFields.some((v) => hasMeaningfulText(v))) return true;

  return false;
}

