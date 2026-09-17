/**
 * Section 1 — Attention Needed + Aging Overdue.
 * Set NEXT_PUBLIC_ATTENTION_INSIGHTS_ENABLED=false to hide (and ATTENTION_INSIGHTS_ENABLED=false on backend to skip SQL).
 */
export const ATTENTION_INSIGHTS_SECTION_ENABLED =
  (process.env.NEXT_PUBLIC_ATTENTION_INSIGHTS_ENABLED ?? 'false').toLowerCase() !== 'false';
