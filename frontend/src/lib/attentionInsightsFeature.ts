/**
 * Section 1 - Attention Needed + Aging Overdue.
 *
 * Off, and no longer switchable from the environment: NEXT_PUBLIC_ATTENTION_INSIGHTS_ENABLED
 * was removed once the sections stopped being used. The component tree and the backend SQL
 * are still here, so re-enabling means flipping this constant AND setting
 * ATTENTION_INSIGHTS_ENABLED=true on the backend - the UI alone would render empty cards.
 */
export const ATTENTION_INSIGHTS_SECTION_ENABLED: boolean = false;
