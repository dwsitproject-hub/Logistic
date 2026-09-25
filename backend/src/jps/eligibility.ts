/**
 * Which STOs owe JPS a Shipping Instruction, and the data to build one.
 *
 * The rule, agreed with Ryan on 2026-09-23:
 *
 *   Region/Site = BONTANG
 *     AND ATC Loading filled          (SAP import or a KLIP edit - one expression, both paths)
 *     AND no discharge ATA at all     (arrival, berthed, start, complete)
 *     AND status not COMPLETED/CANCELLED
 *     AND ETA discharge arrival filled  (JPS requires `eta`)
 *     AND no row in jps_shipping_instructions
 *
 * ATA Sailed appears nowhere. SAP fills it alongside ATC Loading on 1,799 of 1,818 shipments, so
 * requiring it changes nothing - and requiring its absence would mean the trigger never fires.
 *
 * Both guards earn their place. On a copy of production the ATA condition alone matched 58 STOs of
 * which 57 were already COMPLETED, while the status guard alone let through 3 STOs that had
 * already arrived but whose status was never updated. Together: 1.
 */
import { query } from '../database/connection';
import { shipmentListStoKeyExpr } from '../utils/shipmentStoTypeSql';
import type { JpsCargoSource, JpsShipmentSource } from './mapper';

/**
 * ATC Loading and the discharge ATAs, with a KLIP user's edit taking precedence over SAP's value -
 * the same COALESCE shape as sqlEffectiveAtaCompletedLoading() in shipmentAtaOverrideSql.ts.
 */
const EFFECTIVE_ATA_SQL = `
  COALESCE(sao.ata_loading_complete,   s.ata_loading_complete)   AS atc_loading,
  COALESCE(sao.ata_discharge_arrival,  s.ata_discharge_arrival)  AS ata_disch_arrival,
  COALESCE(sao.ata_discharge_berthed,  s.ata_discharge_berthed)  AS ata_disch_berthed,
  COALESCE(sao.ata_discharge_start,    s.ata_discharge_start)    AS ata_disch_start,
  COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete) AS ata_disch_complete`;

/**
 * The STO key - THE SAME ONE THE SHIPMENTS PAGE GROUPS BY.
 *
 * This used to be `COALESCE(shipment_id, operation_id)`, which is a reasonable key and the wrong
 * one: the Shipments list derives its own key differently, and for a manual shipment the two never
 * agree. `shipment_id` is `MNL-…`, which is not numeric, so the list falls through to the
 * contract's `sto_number`, then `effective_sto`, then `operation_id`. KLIP submitted under `MNL-…`
 * and the list looked for something else, so every instruction JPS had accepted still read
 * "Not Sent" on the page.
 *
 * Using the list's own expression removes the second key rather than teaching the two to agree.
 * It also improves the cargo and trade-term lookups, which match `contract_stos.sto_number`: the
 * key is now a real STO number wherever one exists.
 */
const STO_KEY_SQL = shipmentListStoKeyExpr('c', 'l', 's');

export interface EligibleSto extends JpsShipmentSource {
  shipment_ids: string[];
}

/**
 * One row per eligible STO, with its cargo lines already aggregated.
 *
 * Grouping by STO rather than by shipment row is not cosmetic: 470 of 1,042 STOs have more than
 * one `shipments` row, one per PO. Submitting per row would ask JPS to berth the same vessel
 * several times, and `external_reference` being unique per key means every repeat after the first
 * comes back 409.
 */
export interface FindEligibleOptions {
  /** Offer STOs whose last submission JPS rejected, once they have gone cold. See jpsRetryFailed(). */
  retryFailed?: boolean;
  /** How long a rejection is left alone before it is offered again. */
  retryFailedAfterMs?: number;
  /**
   * Load these STOs by name instead of asking which ones are owed an instruction.
   *
   * For amending: an instruction JPS already holds is by definition excluded from the normal
   * answer, and rebuilding its payload needs the same source data the submission was built from.
   * The eligibility conditions still apply - an STO whose vessel has since arrived drops out, and
   * amending it would be pointless anyway.
   */
  stoKeys?: string[];
}

export async function findEligibleStos(
  regionSite: string,
  limit: number,
  options: FindEligibleOptions = {},
): Promise<EligibleSto[]> {
  /*
   * Which STOs the query answers for. By name when amending; otherwise "those not already spoken
   * for", where:
   *
   *   SKIPPED_NO_CARGO is deliberately absent. An STO held back because a product had no JPS
   *   cargo_type, or because its STO quantity looked wrong, must be picked up once the data is
   *   corrected.
   *
   *   SUBMITTED and SKIPPED_PRE_EXISTING are settled for good: both name an instruction JPS
   *   already holds, so re-sending is a duplicate rather than a retry.
   *
   *   FAILED normally blocks too, because a 400 is permanent. $3 lifts that while the fix is on
   *   JPS's side; $4 keeps a rejection cold for a while first, so the sweep firing on every
   *   shipment edit cannot resend the same rejected payload once per save.
   */
  const byKeys = Array.isArray(options.stoKeys);
  const tailWhere = byKeys
    ? `WHERE e.sto_key = ANY($3::text[])`
    : `WHERE NOT EXISTS (
      SELECT 1 FROM jps_shipping_instructions j
      WHERE j.sto_key = e.sto_key
        AND (
          j.state IN ('SUBMITTED', 'SKIPPED_PRE_EXISTING')
          OR (
            j.state = 'FAILED'
            AND (
              $3::boolean IS NOT TRUE
              OR j.updated_at > NOW() - ($4::bigint || ' milliseconds')::interval
            )
          )
        )
    )`;
  const params: unknown[] = byKeys
    ? [regionSite, limit, options.stoKeys]
    : [regionSite, limit, options.retryFailed === true, Math.trunc(options.retryFailedAfterMs ?? 0)];

  const result = await query(
    `
    WITH eligible AS (
      SELECT ${STO_KEY_SQL} AS sto_key,
             MAX(s.eta_discharge_arrival) AS eta_discharge_arrival,
             MAX(s.eta_discharge_complete) AS eta_discharge_complete,
             ARRAY_AGG(DISTINCT s.id::text) AS shipment_ids,
             ARRAY_AGG(DISTINCT s.contract_id::text) FILTER (WHERE s.contract_id IS NOT NULL) AS contract_ids
      FROM shipments s
      LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
      INNER JOIN contracts c ON c.id = s.contract_id
      INNER JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
      CROSS JOIN LATERAL (SELECT ${EFFECTIVE_ATA_SQL}) eff
      WHERE UPPER(TRIM(COALESCE(l.discharge_destination, ''))) = UPPER(TRIM($1))
        AND ${STO_KEY_SQL} IS NOT NULL
        AND eff.atc_loading IS NOT NULL
        AND eff.ata_disch_arrival IS NULL
        AND eff.ata_disch_berthed IS NULL
        AND eff.ata_disch_start IS NULL
        AND eff.ata_disch_complete IS NULL
        AND COALESCE(s.status, '') NOT IN ('COMPLETED', 'CANCELLED')
        AND s.eta_discharge_arrival IS NOT NULL
      GROUP BY 1
    ),
    vessel AS (
      -- The vessel of record for the STO. master_vessels.dhm_code is the vessel_hub_code JPS
      -- prefers; it is empty everywhere until the DHM sync runs, so vessel_name carries the pilot.
      SELECT e.sto_key,
             (ARRAY_AGG(mv.dhm_code ORDER BY mv.updated_at DESC)
                FILTER (WHERE mv.dhm_code IS NOT NULL))[1] AS vessel_hub_code,
             (ARRAY_AGG(COALESCE(mv.vessel_name, s.vessel_name) ORDER BY s.updated_at DESC)
                FILTER (WHERE COALESCE(mv.vessel_name, s.vessel_name) IS NOT NULL))[1] AS vessel_name
      FROM eligible e
      INNER JOIN shipments s ON TRUE
      INNER JOIN contracts c ON c.id = s.contract_id
      LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
      LEFT JOIN master_vessel_code_aliases a
        ON UPPER(TRIM(a.vessel_code)) = UPPER(TRIM(s.vessel_code))
      LEFT JOIN master_vessels mv ON mv.id = COALESCE(s.master_vessel_id, a.master_vessel_id)
      WHERE ${STO_KEY_SQL} = e.sto_key
      GROUP BY e.sto_key
    ),
    terms AS (
      -- One instruction carries one trade term, so the STO's contracts have to agree. When they do
      -- not, none is sent - the field is optional and a wrong term is worse than a missing one.
      SELECT e.sto_key,
             CASE WHEN COUNT(DISTINCT UPPER(TRIM(COALESCE(c.incoterm, '')))) = 1
                  THEN MAX(UPPER(TRIM(c.incoterm))) END AS incoterm
      FROM eligible e
      INNER JOIN contract_stos cs ON UPPER(TRIM(cs.sto_number)) = UPPER(e.sto_key)
      INNER JOIN contracts c ON c.id = cs.contract_id
      GROUP BY e.sto_key
    ),
    cargo AS (
      -- One line per (STO, contract). contract_stos is UNIQUE on that pair, but a contract can
      -- still appear on several STO items, so the quantity is summed and contract_no stays unique
      -- within the instruction - PATCH identifies a line by contract_no or line_order.
      SELECT e.sto_key,
             JSONB_AGG(JSONB_BUILD_OBJECT(
               'contract_no', x.contract_no,
               'po_no', x.po_no,
               'product', x.product,
               'sto_quantity_kg', x.sto_quantity_kg,
               'contract_quantity_kg', x.contract_quantity_kg
             ) ORDER BY x.contract_no) AS lines
      FROM eligible e
      INNER JOIN LATERAL (
        SELECT c.contract_id AS contract_no,
               c.po_number AS po_no,
               c.product AS product,
               SUM(cs.sto_quantity) AS sto_quantity_kg,
               MAX(c.quantity_ordered) AS contract_quantity_kg
        FROM contract_stos cs
        INNER JOIN contracts c ON c.id = cs.contract_id
        WHERE UPPER(TRIM(cs.sto_number)) = UPPER(e.sto_key)
        GROUP BY c.contract_id, c.po_number, c.product

        UNION ALL

        /*
         * Manual shipments (MNL- / OP- keys) exist precisely because SAP has not issued an STO
         * yet, so contract_stos holds nothing for them and SAP's own STO Quantity reads 0 - not a
         * field KLIP failed to ingest, simply a quantity that does not exist yet. 35 of 684
         * BONTANG shipments are in this state.
         *
         * Ryan chose the contract quantity as the stand-in. The guard is the NOT EXISTS below:
         * the fallback applies only when the contract has NO contract_stos row anywhere. If it has
         * one on another STO, that STO already carries the quantity, and sending the whole
         * contract here would book berth space twice. 30 of the 35 qualify; the other 5 wait for
         * SAP, and resolve on their own once the STO is issued.
         */
        SELECT c.contract_id AS contract_no,
               c.po_number AS po_no,
               c.product AS product,
               c.quantity_ordered AS sto_quantity_kg,
               c.quantity_ordered AS contract_quantity_kg
        FROM contracts c
        WHERE c.id::text = ANY(COALESCE(e.contract_ids, ARRAY[]::text[]))
          AND NOT EXISTS (
            SELECT 1 FROM contract_stos cs2 WHERE UPPER(TRIM(cs2.sto_number)) = UPPER(e.sto_key)
          )
          AND NOT EXISTS (
            SELECT 1 FROM contract_stos cs3 WHERE cs3.contract_id = c.id
          )
      ) x ON TRUE
      GROUP BY e.sto_key
    )
    SELECT e.sto_key,
           e.eta_discharge_arrival,
           e.eta_discharge_complete,
           e.shipment_ids,
           v.vessel_hub_code,
           v.vessel_name,
           t.incoterm,
           COALESCE(g.lines, '[]'::jsonb) AS cargo
    FROM eligible e
    LEFT JOIN vessel v ON v.sto_key = e.sto_key
    LEFT JOIN terms t ON t.sto_key = e.sto_key
    LEFT JOIN cargo g ON g.sto_key = e.sto_key
    -- Filtered here rather than in the CTE's HAVING: the STO key is a grouped EXPRESSION, and a
    -- subquery referencing it inside HAVING cannot see it (42803, "ungrouped column").
    --
    ${tailWhere}
    ORDER BY e.eta_discharge_arrival, e.sto_key
    LIMIT $2
    `,
    params,
  );

  return result.rows.map((row: Record<string, unknown>) => ({
    sto_key: String(row.sto_key),
    revision: 1,
    vessel_name: (row.vessel_name as string | null) ?? null,
    vessel_hub_code: (row.vessel_hub_code as string | null) ?? null,
    eta_discharge_arrival: row.eta_discharge_arrival,
    eta_discharge_complete: row.eta_discharge_complete,
    incoterm: (row.incoterm as string | null) ?? null,
    shipment_ids: (row.shipment_ids as string[]) ?? [],
    cargo: ((row.cargo as JpsCargoSource[]) ?? []).map((line) => ({
      contract_no: line.contract_no ?? null,
      po_no: line.po_no ?? null,
      product: line.product ?? null,
      sto_quantity_kg: line.sto_quantity_kg == null ? null : Number(line.sto_quantity_kg),
      contract_quantity_kg:
        line.contract_quantity_kg == null ? null : Number(line.contract_quantity_kg),
    })),
  }));
}
