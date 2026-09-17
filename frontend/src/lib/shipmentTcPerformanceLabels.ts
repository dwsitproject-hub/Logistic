import { FIELD_HELP } from '@/lib/fieldHelpText'

/** Shared TC Vessel Performance labels (Edit modal, Vessel Detail modal, view tables). */
export const TC_VESSEL_PERF_LABELS = {
  sectionTitle: 'Current Shipment T/C Vessel Performance',
  sectionAvgTitle: 'TC Vessel Performance (avg)',
  fuelConsumptionKl: 'Fuel Consumption (KL)',
  freightActualIdrKg: 'Freight Actual (IDR/KG)',
  freightBudgetIdrKg: 'Freight Budget (IDR/KG)',
  pumpRateMtH: 'Pump Rate (MT/H)',
  sailingSpeed: 'Sailing Speed',
  shortageMt: 'Shortage (MT)',
} as const

export const TC_VESSEL_PERF_TOOLTIPS = {
  fuelConsumptionKl:
    'Manually entered TC (Time Charter) vessel metric (KL). By Vessel shows the average across shown shipments.',
  freightActualIdrKg:
    'Manually entered TC (Time Charter) freight actual (IDR/KG). By Vessel shows the average across shown shipments.',
  freightBudgetIdrKg:
    'SAP Vessel OA Budget (IDR/KG). By Vessel shows the average across shown shipments.',
  pumpRateMtH:
    'Manually entered TC (Time Charter) pump rate (MT/H). By Vessel shows the average across shown shipments.',
  sailingSpeed:
    'Manually entered TC (Time Charter) sailing speed. By Vessel shows the average across shown shipments.',
  shortageMt: FIELD_HELP.shipmentTcShortageMt,
} as const

export const TC_VESSEL_TOP_RANK_METRIC_LABELS = [
  TC_VESSEL_PERF_LABELS.fuelConsumptionKl,
  TC_VESSEL_PERF_LABELS.freightActualIdrKg,
  TC_VESSEL_PERF_LABELS.pumpRateMtH,
  TC_VESSEL_PERF_LABELS.sailingSpeed,
  TC_VESSEL_PERF_LABELS.shortageMt,
] as const
