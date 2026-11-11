import { sqlShipmentListPrimaryOrderBy } from './shipmentListPrimaryShipmentSql';

/**
 * Filling the working SFAL / SFBD figure of a shipment from SAP's own (SAP Phase 3 template, 2026-11).
 *
 * SFAL / SFBD belong to the SHIPMENT - the STO, the voyage - not to a PO (Ryan, 2026-11-11). SAP sends them on every PO x STO row, so the import writes each row's figure to
 * shipments.sap_sfal_qty / sap_sfbd_qty (a reference, like sap_ata_*) and this module derives ONE figure per STO from those rows, once per import:
 * sap_sfal_sto_qty / sap_sfbd_sto_qty (migration 263) on the STO's primary row as the reference, and sfal_qty / sfbd_qty - the figure users see and edit - on the same row.
 *
 * What SAP's rows of a multi-PO STO mean was measured on the 11 Nov 2026 file against each STO's total B/L (191 STOs with an SFAL): 176 are SHARES (the rows add up to the
 * voyage's B/L, each row is its PO's B/L times one ratio), 6 repeat the WHOLE voyage figure on every PO, 8 are neither. The STO's figure is therefore decided from the evidence of
 * each STO, not by a blanket rule. In this order, with B/L = the sum of the STO's live rows' bl_quantity:
 *
 *   1. one shipment row: that row's figure (no B/L needed);
 *   2. every row that has a figure carries the SAME figure, and it is within 5% of the B/L, while the rows' sum is not: the whole voyage figure repeated - take ONE;
 *   3. the rows' sum is within 5% of the B/L: shares (or the whole figure on one row) - take the SUM;
 *   4. every row with a B/L has a figure, and figure / B/L is the same ratio on all of them (0.8 to 1.25, spread 1%): shares of a voyage SAP measured off the B/L - take the SUM;
 *   5. anything else is undecided: no STO figure, nothing filled; SAP's rows stay in sap_sfal_qty for whoever has to look.
 *
 * Rule 2 comes before rule 3 so that two POs of 500,000 kg each repeating 1,000,000 are not read as shares of 2,000,000.
 *
 * The B/L is SAP's, read from the LATEST sap_processed_data row of each PO x STO (its "B/L Quantity" header, kg; MT / TO / TON are x1000), NOT from shipments.bl_quantity:
 * the importer's bucket rule does not list "b/l quantity" for the shipment object (only "b/l qty uom"), so that column has been empty - 3,023 of 3,024 shipments on SIT, found by
 * the dry run of this very rule, where every multi-PO STO came out undecided for want of a B/L. Fixing the bucket would change the B/L the modal shows and everything computed from it,
 * which is not this change's to decide. Only the ids of the newest rows are picked by their keys; the JSON is read for those alone.
 *
 * Two things never change:
 * - A user's figure. klip_edited_fields holds the column once a user saved it (migration 167; migration 255 marks the figures that existed before the template as the users').
 *   If ANY live row of the STO is marked, the STO is the user's: nothing is written, not even to the other rows. A user who clears the field has written it too: it stays empty.
 *   The STO-level SAP figure is still written, so the modal can show it beside the user's.
 * - Cancelled shipments. They take no part in the STO and are never written.
 *
 * "The STO's primary row" is the row the Shipments list opens (sqlShipmentListPrimaryOrderBy, the same ordering the list, Oil Loss and the pipeline summary use). Oil Loss reads the
 * opened row alone, and a sibling must not fill its blank, so the figure has to sit exactly there. The list reads MAX(sfal_qty) over the group and nothing sums it, so one row is right.
 * A figure SAP wrote earlier on another row of an STO that is now decided is removed from that row (unmarked = SAP's, by construction).
 *
 * Set-based on purpose: the row-by-row import cannot know an STO's final rows, and one statement does not depend on the order the rows arrive in.
 */
export type SapFigureColumn = 'sfal_qty' | 'sfbd_qty';

const SAP_REFERENCE_COLUMN: Record<SapFigureColumn, string> = {
  sfal_qty: 'sap_sfal_qty',
  sfbd_qty: 'sap_sfbd_qty',
};

const SAP_STO_REFERENCE_COLUMN: Record<SapFigureColumn, string> = {
  sfal_qty: 'sap_sfal_sto_qty',
  sfbd_qty: 'sap_sfbd_sto_qty',
};

/** How far a figure may sit from the B/L and still be read as "the voyage's B/L" (rules 2 and 3). */
export const SAP_FIGURE_BL_TOLERANCE = 0.05;
/** Rule 4: figure / B/L is one ratio on every row, inside this band, with at most this spread (max / min). */
export const SAP_FIGURE_SHARE_RATIO_MIN = 0.8;
export const SAP_FIGURE_SHARE_RATIO_MAX = 1.25;
export const SAP_FIGURE_SHARE_RATIO_SPREAD = 1.01;

/**
 * A few SAP rows carry the figure in TONNES while the unit column says KG (497.799 for a B/L of 500,000 kg; 2,282.685 for 2,234,530 kg - 10 of 902 SFAL rows in the 11 Nov file).
 * The unit cannot tell them apart, the B/L can: a figure under 10,000 whose x1000 is within 10% of the same row's B/L is tonnes. A small real load (9,956 kg against a B/L of 9,960)
 * is left alone, and so is a row whose B/L is itself in tonnes - nothing to compare with.
 */
export function normalizeSapFigureKg(figureKg: number | null, blKg: number | null): number | null {
  if (figureKg === null || !(figureKg > 0)) return figureKg;
  if (figureKg >= 10000 || blKg === null || !(blKg > 0)) return figureKg;
  return Math.abs((figureKg * 1000) / blKg - 1) <= 0.1 ? figureKg * 1000 : figureKg;
}

/** The common table expressions every statement below starts from: live rows, per-STO evidence, the decision and the primary row. */
function figureCtes(column: SapFigureColumn): string {
  const sap = SAP_REFERENCE_COLUMN[column];
  const tol = SAP_FIGURE_BL_TOLERANCE;
  const key = 'TRIM(s.shipment_id::text)';
  const live = `NULLIF(TRIM(s.shipment_id::text), '') IS NOT NULL
         AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')`;
  return `
    latest_sap_row AS (
      SELECT DISTINCT ON (TRIM(spd.contract_number), TRIM(spd.sto_number::text)) spd.id
        FROM sap_processed_data spd
       WHERE NULLIF(TRIM(spd.contract_number), '') IS NOT NULL
         AND NULLIF(TRIM(spd.sto_number::text), '') IS NOT NULL
       ORDER BY TRIM(spd.contract_number), TRIM(spd.sto_number::text), spd.created_at DESC, spd.id DESC
    ),
    sap_bl AS (
      SELECT x.contract_number, x.sto,
             CASE WHEN x.bl_text ~ '^[0-9]+(\\.[0-9]+)?$'
                  THEN x.bl_text::numeric * CASE WHEN x.bl_uom IN ('MT', 'TO', 'TON', 'TONS', 'T') THEN 1000 ELSE 1 END
             END AS bl_kg
        FROM (
          SELECT TRIM(spd.contract_number) AS contract_number, TRIM(spd.sto_number::text) AS sto,
                 REPLACE(TRIM(COALESCE(spd.data->'raw'->>'B/L Quantity', '')), ',', '') AS bl_text,
                 UPPER(TRIM(COALESCE(spd.data->'raw'->>'B/L Qty UoM', ''))) AS bl_uom
            FROM sap_processed_data spd
            JOIN latest_sap_row r ON r.id = spd.id
        ) x
    ),
    live AS (
      SELECT s.id, ${key} AS sto, s.${sap} AS sap, COALESCE(b.bl_kg, s.bl_quantity) AS bl,
             ('${column}' = ANY(COALESCE(s.klip_edited_fields, '{}'))) AS owned
        FROM shipments s
        LEFT JOIN contracts c ON c.id = s.contract_id
        LEFT JOIN sap_bl b ON b.contract_number = TRIM(c.contract_id) AND b.sto = ${key}
       WHERE ${live}
    ),
    agg AS (
      SELECT sto,
             COUNT(*) AS n_rows,
             COUNT(*) FILTER (WHERE sap > 0) AS n_sap,
             SUM(sap) FILTER (WHERE sap > 0) AS sum_sap,
             MIN(sap) FILTER (WHERE sap > 0) AS min_sap,
             MAX(sap) FILTER (WHERE sap > 0) AS max_sap,
             SUM(COALESCE(bl, 0)) AS sum_bl,
             COUNT(*) FILTER (WHERE COALESCE(bl, 0) > 0 AND NOT (COALESCE(sap, 0) > 0)) AS bl_without_sap,
             COUNT(*) FILTER (WHERE COALESCE(sap, 0) > 0 AND NOT (COALESCE(bl, 0) > 0)) AS sap_without_bl,
             MIN(sap / bl) FILTER (WHERE sap > 0 AND bl > 0) AS min_ratio,
             MAX(sap / bl) FILTER (WHERE sap > 0 AND bl > 0) AS max_ratio,
             BOOL_OR(owned) AS any_owned
        FROM live
       GROUP BY sto
    ),
    decided AS (
      SELECT sto, any_owned,
             CASE
               WHEN n_sap = 0 THEN NULL
               WHEN n_rows = 1 THEN sum_sap
               WHEN COALESCE(sum_bl, 0) <= 0 THEN NULL
               WHEN n_sap >= 2 AND min_sap = max_sap
                AND ABS(max_sap / sum_bl - 1) <= ${tol}
                AND ABS(sum_sap / sum_bl - 1) > ${tol} THEN max_sap
               WHEN ABS(sum_sap / sum_bl - 1) <= ${tol}
                AND NOT (n_sap >= 2 AND min_sap = max_sap AND ABS(max_sap / sum_bl - 1) <= ${tol}) THEN sum_sap
               WHEN n_sap >= 2 AND bl_without_sap = 0 AND sap_without_bl = 0
                AND min_ratio >= ${SAP_FIGURE_SHARE_RATIO_MIN} AND max_ratio <= ${SAP_FIGURE_SHARE_RATIO_MAX}
                AND max_ratio / min_ratio <= ${SAP_FIGURE_SHARE_RATIO_SPREAD} THEN sum_sap
             END AS total
        FROM agg
    ),
    carrier AS (
      SELECT DISTINCT ON (${key}) ${key} AS sto, s.id AS carrier_id
        FROM shipments s
        LEFT JOIN contract_stos cs_sto ON cs_sto.contract_id = s.contract_id
         AND NULLIF(TRIM(cs_sto.sto_number::text), '') IS NOT NULL
         AND TRIM(cs_sto.sto_number::text) = ${key}
        LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
       WHERE ${live}
       ORDER BY ${key}, ${sqlShipmentListPrimaryOrderBy('s.shipment_id', 'c', 'l', 's', 'cs_sto', 'sao')}
    ),
    target AS (
      SELECT d.sto, d.total, d.any_owned, c.carrier_id
        FROM decided d
        JOIN carrier c ON c.sto = d.sto
       WHERE d.total IS NOT NULL
    )`;
}

export interface SapFigureFillStatements {
  /** The STO-level SAP figure is removed from every row that is no longer the primary row of a decided STO. */
  clearReference: string;
  /** The STO-level SAP figure is written on the primary row of each decided STO (also when the STO is a user's). */
  setReference: string;
  /** The working figure is written on the primary row of each decided STO that no user owns. Its rowCount is "how many shipments this column filled". */
  setWorking: string;
  /** A figure SAP wrote earlier on another row of a decided STO that no user owns is removed from that row. */
  clearSiblings: string;
}

export function buildSapFigureFillStatements(column: SapFigureColumn): SapFigureFillStatements {
  const ref = SAP_STO_REFERENCE_COLUMN[column];
  const ctes = figureCtes(column);
  return {
    clearReference: `WITH ${ctes}
      UPDATE shipments s
         SET ${ref} = NULL
       WHERE s.${ref} IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM target t WHERE t.carrier_id = s.id)`,
    setReference: `WITH ${ctes}
      UPDATE shipments s
         SET ${ref} = t.total
        FROM target t
       WHERE s.id = t.carrier_id
         AND s.${ref} IS DISTINCT FROM t.total`,
    setWorking: `WITH ${ctes}
      UPDATE shipments s
         SET ${column} = t.total,
             updated_at = CURRENT_TIMESTAMP
        FROM target t
       WHERE s.id = t.carrier_id
         AND NOT t.any_owned
         AND s.${column} IS DISTINCT FROM t.total`,
    clearSiblings: `WITH ${ctes}
      UPDATE shipments s
         SET ${column} = NULL,
             updated_at = CURRENT_TIMESTAMP
        FROM target t
       WHERE TRIM(s.shipment_id::text) = t.sto
         AND s.id <> t.carrier_id
         AND NOT t.any_owned
         AND s.${column} IS NOT NULL
         AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')`,
  };
}

/**
 * What the fill would decide for every STO that has a SAP figure, without writing anything: one row per STO with the evidence and the outcome
 * (single / sum / one = the repeated figure taken once / undecided). For a dry run inside a transaction that is rolled back, and for whoever has to explain a figure.
 */
export function buildSapFigureDecisionPreviewSql(column: SapFigureColumn): string {
  return `WITH ${figureCtes(column)}
    SELECT a.sto, a.n_rows::int AS n_rows, a.n_sap::int AS n_sap, a.sum_sap, a.max_sap, a.sum_bl, d.total, d.any_owned, c.carrier_id,
           CASE
             WHEN d.total IS NULL THEN 'undecided'
             WHEN a.n_rows = 1 THEN 'single'
             WHEN d.total = a.sum_sap THEN 'sum'
             ELSE 'one'
           END AS how
      FROM agg a
      JOIN decided d ON d.sto = a.sto
      LEFT JOIN carrier c ON c.sto = a.sto
     WHERE a.n_sap > 0`;
}
