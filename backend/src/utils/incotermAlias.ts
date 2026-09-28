/**
 * Incoterm spellings that mean the same term, mapped to the one KLIP uses.
 *
 * CNF and C&F are older names for CFR (Cost and Freight). SAP sent contract 1624000075 - 6,900 MT
 * of CPO, SEA, nothing delivered and already past its delivery window - as CNF. Every page that
 * scopes by incoterm lists CFR, so the contract was on Contract Performance and on no execution
 * page at all: not Shipments, not Shipping Performance. Even the cross-page invariants script
 * missed it, because it filters both sides of its comparison with the same list.
 *
 * Normalising here rather than adding CNF to each list is deliberate: there are dozens of places
 * that compare an incoterm against a literal list (the Dashboard alone has more than twenty), and
 * one alias map applied where the value enters KLIP fixes all of them at once.
 *
 * This is the only definition. The SAP parser, the manual contract form, the effective-incoterm
 * SQL and the JS classifier all read it.
 */
export const INCOTERM_ALIASES: Readonly<Record<string, string>> = {
  CNF: 'CFR',
  'C&F': 'CFR',
};

function aliasOf(value: string): string | undefined {
  return INCOTERM_ALIASES[value.trim().toUpperCase()];
}

/**
 * The canonical spelling when `value` is an alias; otherwise `value` exactly as given.
 *
 * Deliberately leaves non-alias values untouched - no trimming, no case change - so applying it to
 * incoming data changes nothing except the aliases themselves.
 */
export function canonicalIncoterm<T>(value: T): T | string {
  if (typeof value !== 'string') return value;
  return aliasOf(value) ?? value;
}

/** Trimmed, upper-cased and de-aliased: the form every incoterm comparison should use. */
export function normalizeIncoterm(value: string | null | undefined): string {
  const upper = String(value ?? '').trim().toUpperCase();
  return INCOTERM_ALIASES[upper] ?? upper;
}

/**
 * SQL form, for an expression that is ALREADY trimmed and upper-cased.
 *
 * regexp_replace reads its input once. A CASE WHEN x IN (...) THEN 'CFR' ELSE x END would evaluate
 * x twice - and contractEffectiveIncotermExpr carries a correlated sap_processed_data subquery,
 * spliced into 27 call sites.
 */
export function sqlCanonicalIncotermExpr(upperTrimmedExpr: string): string {
  const keys = Object.keys(INCOTERM_ALIASES);
  // Aliases are plain letters or '&', so they can go into the pattern without escaping - and a
  // quote can never reach the SQL literal.
  if (keys.some((k) => !/^[A-Z&]+$/.test(k))) {
    throw new Error('incoterm aliases must be upper-case letters or &');
  }
  const alternation = keys.join('|');
  const target = new Set(Object.values(INCOTERM_ALIASES));
  if (target.size !== 1) {
    // One replacement string can only express aliases that share a target.
    throw new Error('sqlCanonicalIncotermExpr supports aliases of a single canonical incoterm');
  }
  return `regexp_replace(${upperTrimmedExpr}, '^(${alternation})$', '${[...target][0]}')`;
}
