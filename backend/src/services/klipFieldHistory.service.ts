import { query } from '../database/connection';
import logger from '../utils/logger';

/**
 * Who last changed a field through KLIP, and when.
 *
 * `klip_edited_fields` (migration 167) answers *whether* a user wrote a field; it deliberately
 * stores nothing else, so the row stays small and the marker stays cheap to maintain. The name and
 * the date come from `audit_logs`, which already records the request body per update along with
 * the user and the timestamp.
 *
 * Two limits worth stating, because they decide how the result may be presented:
 *
 * - `before_data` is the request body, not the previous stored value. So this says "a user
 *   submitted this field", never "this replaced SAP's X".
 * - the log only starts where `auditLog` was attached to each route, and it never fires for the
 *   SAP import, the scheduler or scripts. An absent entry therefore means "not recorded", which
 *   is not the same as "never edited".
 */
export type KlipFieldEdit = {
  column: string;
  at: string;
  by: string | null;
};

const AUDITED_ENTITY_TYPES = ['SHIPMENT', 'LOADING_PORT'];

/**
 * Latest KLIP edit per field for a shipment and its port rows.
 *
 * Returns at most one entry per column - the most recent - because that is what a tooltip can
 * usefully show. Older entries stay in `audit_logs` for anyone who needs the full trail.
 */
export async function loadKlipFieldHistory(shipmentId: string): Promise<Record<string, KlipFieldEdit>> {
  try {
    const res = await query(
      `WITH scope AS (
         SELECT $1::uuid AS entity_id
         UNION
         SELECT vlp.id FROM vessel_loading_ports vlp WHERE vlp.shipment_id = $1::uuid
       )
       SELECT
         a.entity_id,
         a.before_data,
         a.timestamp,
         COALESCE(NULLIF(TRIM(u.username), ''), u.email) AS user_label
       FROM audit_logs a
       INNER JOIN scope s ON s.entity_id = a.entity_id
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action = 'UPDATE'
         AND a.entity_type = ANY($2::text[])
         AND a.before_data IS NOT NULL
       ORDER BY a.timestamp DESC`,
      [shipmentId, AUDITED_ENTITY_TYPES],
    );

    const out: Record<string, KlipFieldEdit> = {};
    for (const row of res.rows as Array<{
      before_data: unknown;
      timestamp: string;
      user_label: string | null;
    }>) {
      const body = row.before_data;
      if (!body || typeof body !== 'object' || Array.isArray(body)) continue;
      for (const column of Object.keys(body as Record<string, unknown>)) {
        // Rows arrive newest first, so the first sighting of a column is its latest edit.
        if (out[column]) continue;
        out[column] = {
          column,
          at: String(row.timestamp),
          by: row.user_label,
        };
      }
    }
    return out;
  } catch (error) {
    /*
     * History is decoration on top of the marker: the badge is correct without it. A failure here
     * must not take the Edit Shipment modal down with it.
     */
    logger.error('KLIP field history lookup failed', {
      shipmentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}
