/**
 * The Jetty Status KLIP shows, which is JPS's own status plus one derived stage.
 *
 * JPS goes Pending -> Approved -> Allocated and then straight to Sailed. Between Allocated and Sailed the vessel finishes
 * discharging: JPS logs the end of the cargo operation (`cargo_ops_end_at`, KLIP's ATC Discharge / Hose Off) but its status
 * stays Allocated until the vessel sails. KLIP shows that stretch as "Completed (Hose Off)" so the list does not read
 * Allocated for a berth that has already finished.
 *
 * It is derived at read time and never stored: `jps_shipping_instructions.jps_status` stays exactly what JPS reported (the
 * poller, the webhook and the amend step read it), and the stage ends by itself when JPS reports Sailed. Only a status that
 * can still move gets it - a Sailed or Rejected instruction keeps its own.
 */
export const JETTY_STATUS_HOSE_OFF = 'Completed (Hose Off)';

/** Statuses that can still move; the same set the poller keeps polling. */
const JETTY_STATUSES_BEFORE_SAILED = `'Pending', 'Approved', 'Allocated'`;

/** SQL for the status shown, over a `jps_shipping_instructions` row (or a subselect carrying these two columns). */
export function sqlJettyStatusShown(alias: string): string {
  return `CASE
          WHEN ${alias}.schedule_cargo_ops_end_at IS NOT NULL
           AND ${alias}.jps_status IN (${JETTY_STATUSES_BEFORE_SAILED})
          THEN '${JETTY_STATUS_HOSE_OFF}'
          ELSE ${alias}.jps_status
        END`;
}
