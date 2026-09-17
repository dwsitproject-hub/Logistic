/**
 * The note under Section 1 that tells a viewer where its quantities came from.
 *
 * Section 1's card quantities and Outstanding Qty strip used to be scanned live on every cold
 * load, which measured ~23-37s. They are now precomputed by the trucking pipeline refresh, which
 * makes the page fast at the cost of trailing a SAP import by however long the build takes
 * (measured 234s). That trade was chosen deliberately - but someone reading a quantity off a card
 * has no way to know it is a few minutes behind, so the page says so.
 *
 * Returns null when the figures were computed live: there is nothing to warn about, and a badge
 * that is always present is a badge nobody reads.
 */
export interface TruckingSummaryFreshness {
  source?: 'snapshot' | 'live';
  asOf?: string | null;
  isStale?: boolean;
}

export interface TruckingSummaryFreshnessNote {
  /** Short label for the badge. */
  label: string;
  /** The sentence explaining what it means, for the tooltip or inline text. */
  detail: string;
  /** `pending` while a rebuild is due or running, otherwise `info`. */
  tone: 'info' | 'pending';
}

/** Local time, to the minute - the seconds are noise at this granularity. */
export function formatTruckingSummaryAsOf(asOf: string | null | undefined): string | null {
  if (!asOf) return null;
  const at = new Date(asOf);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function describeTruckingSummaryFreshness(
  freshness: TruckingSummaryFreshness | null | undefined,
): TruckingSummaryFreshnessNote | null {
  if (!freshness || freshness.source !== 'snapshot') return null;

  const at = formatTruckingSummaryAsOf(freshness.asOf);
  const asOfText = at ? `as of ${at}` : 'as of the last scheduled refresh';

  if (freshness.isStale === true) {
    return {
      label: `Quantities ${asOfText}`,
      detail:
        'Card quantities and Outstanding Qty come from the scheduled refresh, and a rebuild is due or running - a recent SAP import may not be reflected yet.',
      tone: 'pending',
    };
  }

  return {
    label: `Quantities ${asOfText}`,
    detail:
      'Card quantities and Outstanding Qty come from the scheduled refresh, so a SAP import can take a few minutes to appear here. Row-level quantities in the table below are live.',
    tone: 'info',
  };
}
