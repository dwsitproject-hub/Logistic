/** When false, skip live SQL for Attention Needed + Aging Overdue (lighter summaryOnly). */
export function isAttentionInsightsEnabled(): boolean {
  return String(process.env.ATTENTION_INSIGHTS_ENABLED ?? 'false').toLowerCase() !== 'false';
}
