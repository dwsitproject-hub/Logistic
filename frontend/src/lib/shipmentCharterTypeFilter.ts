export const SHIPMENT_CHARTER_TYPE_FILTER_ALL = 'ALL' as const

export const SHIPMENT_CHARTER_TYPE_FILTER_OPTIONS = [
  { value: SHIPMENT_CHARTER_TYPE_FILTER_ALL, label: 'All Charter Type' },
  { value: 'T/C', label: 'T/C' },
  { value: 'V/C', label: 'V/C' },
  { value: 'CIF', label: 'CIF' },
] as const

export type ShipmentCharterTypeFilter =
  | typeof SHIPMENT_CHARTER_TYPE_FILTER_ALL
  | 'T/C'
  | 'V/C'
  | 'CIF'
