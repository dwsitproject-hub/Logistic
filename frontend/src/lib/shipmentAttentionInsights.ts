import { mapAttentionInsights, type AttentionInsightsData } from '@/lib/attentionInsights'

export type ShipmentAttentionInsightsData = AttentionInsightsData

/** Map API camelCase payload from summary.attentionInsights (Shipments). */
export function mapShipmentAttentionInsights(raw: unknown): ShipmentAttentionInsightsData | null {
  return mapAttentionInsights(raw)
}
