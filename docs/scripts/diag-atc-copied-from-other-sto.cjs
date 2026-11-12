/*
 * READ-ONLY: how many shipments carry a discharge-port ATA that SAP sent for ANOTHER STO of the same contract / PO?
 *
 *   cat docs/scripts/diag-atc-copied-from-other-sto.cjs | docker exec -i klip-backend node -
 *
 * Found on operation OP-1004030473-49138234 (2026-11-12): five shipments with a manual STO (MNL-...) showed an ATC (2026-09-15) nobody typed. SAP knows no MNL- STO, so the
 * port sync (resolveLatestSapParsedDataForShipment) fell back to ANY SAP row of the contract and wrote the ATC of an old voyage (STO 1006019867) into their discharge-port rows.
 *
 * For every live shipment with an ATA on its discharge-port row this prints the class of that date:
 *   USER          the column is marked in klip_edited_fields: a person wrote it
 *   SAP_OWN       SAP's ATC of the shipment's OWN STO equals it (fine)
 *   COPIED        SAP has no row for its own STO (or another date there) and ANOTHER STO of the same contract carries exactly this ATC: a copy
 *   UNKNOWN       unmarked, matches no SAP row of the contract (older data, or a copy whose source row is gone)
 * and, for COPIED / UNKNOWN, whether that date is the ATC the page actually SHOWS (no override ATC and no ATC in shipments.ata_discharge_complete).
 */
const pool = require('./dist/database/connection').default;

const SAP_DATE = (t) => `CASE
  WHEN ${t} ~ '^\\d{1,2}/\\d{1,2}/\\d{2}$' THEN to_date(${t}, 'MM/DD/YY')
  WHEN ${t} ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN to_date(${t}, 'MM/DD/YYYY')
  WHEN ${t} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(${t} from 1 for 10)::date
  WHEN ${t} ~ '^\\d{2}\\.\\d{2}\\.\\d{4}$' THEN to_date(${t}, 'DD.MM.YYYY')
END`;

const BASE = `
  WITH sap_rows AS (
    SELECT DISTINCT ON (TRIM(spd.contract_number), TRIM(spd.sto_number::text))
           TRIM(spd.contract_number) AS cn, TRIM(spd.sto_number::text) AS sto,
           ${SAP_DATE("TRIM(COALESCE(spd.data->'raw'->>'ATA Vessel Complete Discharge', ''))")} AS sap_atc
      FROM sap_processed_data spd
     WHERE NULLIF(TRIM(spd.sto_number::text), '') IS NOT NULL
     ORDER BY TRIM(spd.contract_number), TRIM(spd.sto_number::text), spd.created_at DESC
  ),
  ship AS (
    SELECT s.id, s.operation_id, TRIM(s.shipment_id::text) AS sto, s.status, c.contract_id AS cn, c.po_number AS po,
           s.ata_discharge_complete::date AS stored_atc, sao.ata_discharge_complete::date AS override_atc,
           v.ata_loading_completed::date AS port_ata, v.sap_ata_loading_completed::date AS port_sap_mirror,
           ('ata_loading_completed' = ANY(COALESCE(v.klip_edited_fields, '{}'))) AS port_user
      FROM shipments s
      JOIN contracts c ON c.id = s.contract_id
      JOIN vessel_loading_ports v ON v.shipment_id = s.id AND COALESCE(v.is_discharge_port, false) AND COALESCE(v.is_cancelled, false) = false
      LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
     WHERE v.ata_loading_completed IS NOT NULL AND UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED')
  ),
  classed AS (
    SELECT sh.*,
           EXISTS (SELECT 1 FROM sap_rows r WHERE r.cn = sh.cn AND r.sto = sh.sto) AS own_in_sap,
           (SELECT r.sap_atc FROM sap_rows r WHERE r.cn = sh.cn AND r.sto = sh.sto) AS own_sap_atc,
           (SELECT r.sto FROM sap_rows r WHERE r.cn = sh.cn AND r.sto <> sh.sto AND r.sap_atc = sh.port_ata LIMIT 1) AS sibling_sto,
           (sh.stored_atc IS NULL AND sh.override_atc IS NULL) AS port_is_the_shown_atc
      FROM ship sh
  ),
  final AS (
    SELECT *,
           CASE
             WHEN port_user THEN 'USER'
             WHEN own_in_sap AND own_sap_atc = port_ata THEN 'SAP_OWN'
             WHEN sibling_sto IS NOT NULL THEN 'COPIED'
             ELSE 'UNKNOWN'
           END AS klass
      FROM classed
  )`;

(async () => {
  const q = async (sql) => (await pool.query(`${BASE} ${sql}`)).rows;
  console.log('live shipments with an ATA on the discharge-port row, by where the date came from:');
  for (const r of await q(`SELECT klass, COUNT(*)::int AS shipments, COUNT(DISTINCT operation_id)::int AS operations,
                                  COUNT(*) FILTER (WHERE port_is_the_shown_atc)::int AS port_ata_is_the_shown_atc,
                                  COUNT(*) FILTER (WHERE port_is_the_shown_atc AND UPPER(COALESCE(status, '')) <> 'COMPLETED')::int AS shown_but_stored_not_completed
                             FROM final GROUP BY klass ORDER BY klass`)) console.log(' ', JSON.stringify(r));

  console.log('\nmanual / operation STOs (not a number) among them:');
  console.log(' ', JSON.stringify((await q(`SELECT COUNT(*)::int AS shipments, COUNT(*) FILTER (WHERE klass IN ('COPIED', 'UNKNOWN'))::int AS copied_or_unknown FROM final WHERE sto !~ '^[0-9]+$'`))[0]));

  console.log('\nCOPIED (the date equals the ATC of another STO of the same contract):');
  for (const r of await q(`SELECT operation_id, po, sto, status, port_ata::text, sibling_sto, own_in_sap, port_sap_mirror::text, port_is_the_shown_atc AS shown FROM final WHERE klass = 'COPIED' ORDER BY operation_id, po LIMIT 40`)) console.log(' ', JSON.stringify(r));

  console.log('\nUNKNOWN, only the ones whose date is the shown ATC (first 20):');
  for (const r of await q(`SELECT operation_id, po, sto, status, port_ata::text, own_in_sap, port_sap_mirror::text FROM final WHERE klass = 'UNKNOWN' AND port_is_the_shown_atc ORDER BY operation_id, po LIMIT 20`)) console.log(' ', JSON.stringify(r));

  // The second way a date reaches a manual shipment: the resolver's "exact" arm also matched contracts.sto_number, the CONTRACT's STO. If that equals an STO SAP
  // sent for the contract, every manual shipment of the contract was handed that voyage's row.
  console.log('\nlive manual / operation shipments whose contract\'s sto_number is an STO SAP has a row for (the second leak):');
  console.log(' ', JSON.stringify((await q(`SELECT COUNT(*)::int AS shipments, COUNT(DISTINCT s.operation_id)::int AS operations
                                               FROM shipments s JOIN contracts c ON c.id = s.contract_id
                                              WHERE UPPER(COALESCE(s.status, '')) NOT IN ('CANCELLED', 'CANCELED') AND TRIM(s.shipment_id::text) !~ '^[0-9]+$'
                                                AND NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL
                                                AND EXISTS (SELECT 1 FROM sap_rows r WHERE r.sto = TRIM(c.sto_number::text))`))[0]));
  const op = process.env.OP || 'OP-1004030473-49138234';
  console.log(`\ncontracts.sto_number of the shipments of ${op}:`);
  for (const r of (await pool.query(`SELECT c.contract_id AS contract, c.po_number AS po, c.sto_number AS contract_sto, s.shipment_id AS shipment_sto FROM shipments s JOIN contracts c ON c.id = s.contract_id WHERE s.operation_id = $1 ORDER BY c.po_number`, [op])).rows) console.log(' ', JSON.stringify(r));
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
