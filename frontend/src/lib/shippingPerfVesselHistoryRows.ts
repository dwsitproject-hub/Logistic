import { applySection3PortDisplay } from './shippingPerformancePorts'
import type { VesselHistoryShipmentRow } from '@/components/shipping-performance/VesselHistoryModal'

/** Map GET /shipments/performance rows for VesselHistoryModal (shared with Shipping Performance). */
export function mapShippingPerformanceToVesselHistoryRows(
  rows: unknown[],
): VesselHistoryShipmentRow[] {
  return rows.map((raw) => applySection3PortDisplay(raw as VesselHistoryShipmentRow))
}
