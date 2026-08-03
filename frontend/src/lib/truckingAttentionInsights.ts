import { mapAttentionInsights, type AttentionInsightsData } from '@/lib/attentionInsights'

/** Mirrors backend TRUCKING_LOSS_ABOVE_THRESHOLD_PCT for UI labels. */
export const TRUCKING_LOSS_ABOVE_THRESHOLD_PCT = -0.5

export type TruckingAttentionInsightsData = AttentionInsightsData

/** Map API camelCase payload from summary.attentionInsights. */
export function mapTruckingAttentionInsights(raw: unknown): TruckingAttentionInsightsData | null {
  return mapAttentionInsights(raw)
}
