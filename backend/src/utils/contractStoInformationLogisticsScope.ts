/**
 * Contract Detail → List STO: which logistics types to show.
 * Prefer incoterm (same split as Shipments vs Trucking pages); MIX alone must not
 * double-list CIF STOs as both shipment and trucking.
 */

import { isShipmentPageSeaIncoterm } from './shipmentIncotermScope';
import { isTruckingPageIncoterm } from './truckingIncotermScope';

export function resolveContractStoInformationLogisticsIncludes(opts: {
  incoterm?: string | null;
  transportMode?: string | null;
}): { includeShipments: boolean; includeTrucking: boolean } {
  const incoterm = String(opts.incoterm ?? '').trim();
  const transportMode = String(opts.transportMode ?? '').trim().toUpperCase();
  const seaIncoterm = isShipmentPageSeaIncoterm(incoterm);
  const landIncoterm = isTruckingPageIncoterm(incoterm);

  if (seaIncoterm && !landIncoterm) {
    return { includeShipments: true, includeTrucking: false };
  }
  if (landIncoterm && !seaIncoterm) {
    return { includeShipments: false, includeTrucking: true };
  }

  // Unknown / blank incoterm — fall back to SEA/LAND/MIX transport mode.
  return {
    includeShipments: transportMode === '' || transportMode === 'SEA' || transportMode === 'MIX',
    includeTrucking: transportMode === '' || transportMode === 'LAND' || transportMode === 'MIX',
  };
}
