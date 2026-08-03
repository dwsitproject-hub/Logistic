/**
 * Contracts view-table Actions — which logistics buttons to show by incoterm.
 * Mirrors backend shipmentIncotermScope (FOB/CIF/CFR) and truckingIncotermScope (FRC/LCO).
 */

export const CONTRACT_SHIPMENT_INCOTERMS = ['FOB', 'CIF', 'CFR'] as const
export const CONTRACT_TRUCKING_INCOTERMS = ['FRC', 'LCO'] as const

export type ContractShipmentIncoterm = (typeof CONTRACT_SHIPMENT_INCOTERMS)[number]
export type ContractTruckingIncoterm = (typeof CONTRACT_TRUCKING_INCOTERMS)[number]

export function normalizeContractIncoterm(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

export function contractShowsAddShipment(incoterm: string | null | undefined): boolean {
  const inc = normalizeContractIncoterm(incoterm)
  return (CONTRACT_SHIPMENT_INCOTERMS as readonly string[]).includes(inc)
}

export function contractShowsAddTrucking(incoterm: string | null | undefined): boolean {
  const inc = normalizeContractIncoterm(incoterm)
  return (CONTRACT_TRUCKING_INCOTERMS as readonly string[]).includes(inc)
}
