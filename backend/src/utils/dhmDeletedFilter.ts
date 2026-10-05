/**
 * Master rows deleted in DHM are flagged (`dhm_is_deleted`), not removed, so history keeps working and the Master
 * tables still show them. A PICKER must not offer them: JPS no longer knows their hub code and would refuse it.
 *
 * Opt-in on purpose. The Master tables and the vessel history search call the same list endpoints and need the
 * deleted rows, so only the dropdowns and comboboxes send `excludeDeleted=true`.
 */
export function wantsExcludeDhmDeleted(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** `AND ...` clause keeping rows that DHM has not deleted; empty when the caller did not ask. */
export function sqlExcludeDhmDeleted(exclude: boolean, column = 'dhm_is_deleted'): string {
  return exclude ? ` AND COALESCE(${column}, FALSE) IS NOT TRUE` : '';
}
