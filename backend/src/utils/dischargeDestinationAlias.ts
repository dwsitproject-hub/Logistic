/**
 * SAP Discharge Destination aliases - the operational Region/Site dimension.
 *
 * SAP names the port; KLIP shows the site the port serves. `KIJING` is the port for the Tanjung
 * Pura plants, and `master_plants` already groups all eight of those (EU4C, EU2C, EU53, EU23,
 * EU73, EU4E, EU2E, MG21) under `group_plant = 'Tanjung Pura'` - so the two dimensions disagreed
 * on the same place: Region/Site said KIJING while Group Plant said Tanjung Pura. Requested
 * 2026-09-08.
 *
 * Deliberately a **many-to-one normalisation, not a display rename.** SAP is expected to start
 * emitting `TANJUNG PURA` as its own discharge location, and when it does both values must
 * collapse into one group rather than appear as two filter entries with the volume split between
 * them. Mapping the target to itself keeps that idempotent.
 *
 * Applied at the single point where the value is extracted from SAP JSON
 * (`sapDischargeDestinationFromJson`) and wherever a *stored* copy of it is read, so no caller
 * has to remember. Adding another alias is one line here.
 */

/** UPPER(TRIM(raw)) -> canonical display value. */
export const DISCHARGE_DESTINATION_ALIASES: Readonly<Record<string, string>> = {
  KIJING: 'TANJUNG PURA',
  'TANJUNG PURA': 'TANJUNG PURA',
};

/** JS-side normalisation (import write path, in-memory filtering). Empty in, empty out. */
export function normalizeDischargeDestination(value: unknown): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return trimmed;
  return DISCHARGE_DESTINATION_ALIASES[trimmed.toUpperCase()] ?? trimmed;
}

/**
 * SQL-side normalisation.
 *
 * A plain CASE, referencing `expr` twice. The obvious alternative - wrapping it in a scalar
 * subquery so it is evaluated once - adds per-row SubPlan overhead and blocks inlining, which is
 * the wrong trade in the aggregates this sits inside (`MAX(...) AS plant_site` over every
 * contract). `expr` here is a COALESCE of jsonb reads on an already-loaded datum, so the second
 * evaluation is cheap, and the planner is free to fold it.
 *
 * NULL and blank pass straight through: the Region/Site helpers decide separately whether a
 * missing destination renders as 'Blank'.
 */
export function sqlNormalizeDischargeDestination(expr: string): string {
  const whens = Object.entries(DISCHARGE_DESTINATION_ALIASES)
    .filter(([from, to]) => from !== to.toUpperCase())
    .map(([from, to]) => `WHEN UPPER(TRIM(${expr})) = '${from}' THEN '${to}'`)
    .join('\n      ');
  if (!whens) return expr;
  return `CASE
      ${whens}
      ELSE ${expr}
    END`;
}
