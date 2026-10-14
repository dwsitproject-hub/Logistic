/*
 * READ-ONLY: what the shipments' operation_id looks like today, and what filling it for the SAP-imported shells would touch.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-operation-id-shells.cjs | docker exec -i klip-backend node -
 *
 * Several SELECTs inside one read-only transaction that is rolled back; nothing is written. Needs no password: it uses the backend container's own connection.
 *
 * WHY. Operation ID is KLIP's own identifier of a transaction (STO is SAP's). SEA shells created by the SAP import carry none, and hasKlipShipmentActivity()
 * treats a non-empty operation_id as "KLIP touched this row", which switches the SAP re-import's field protection on (vessel, ports, delivered / receive qty).
 * So before any id is filled, these numbers decide the design:
 *
 *   A  operation_id by kind x has an official 10-digit STO x status     (how many rows are empty, how many carry which kind)
 *   B  empty rows split by real KLIP activity                           (daily deliverables / audit UPDATE / documents / assignment)
 *   C  rows protected from SAP overwrite TODAY by operation_id alone   (a SAP_IMPORT id does not count: the re-import ignores it)
 *   H  operation_id_source x kind                                       (how many ids KLIP assigned itself)
 *   D  ids shared by more than one STO                                  (an empty row must never adopt one of these)
 *   E  STOs whose rows carry more than one id; plain numbers that point at another STO
 *   F  assignments keyed by an operation id                             (rows to move when a number id is converted)
 *   G  trucking_operations with no operation_id
 */
const path = require('path');
const fs = require('fs');

const DIST = [process.env.KLIP_DIST, '/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].filter(Boolean).find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const pool = require(path.join(DIST, 'database/connection')).default;

const KIND = String.raw`CASE
  WHEN NULLIF(BTRIM(s.operation_id), '') IS NULL THEN '1 empty'
  WHEN s.operation_id ~ '^OP-SEA-' THEN '2 OP-SEA'
  WHEN s.operation_id ~ '^OP-' THEN '3 OP-other'
  WHEN s.operation_id ~ '^[0-9]+$' AND s.operation_id = s.shipment_id THEN '4 number = own STO'
  WHEN s.operation_id ~ '^[0-9]+$' THEN '5 number = ANOTHER STO'
  ELSE '6 other' END`;

// Real KLIP activity apart from operation_id itself (what hasKlipShipmentActivity looks at after its operation_id test).
const OTHER_ACTIVITY = String.raw`(
  s.shipment_id ~ '^(MNL-|MSEA-)'
  OR (s.daily_deliverables IS NOT NULL AND s.daily_deliverables::text NOT IN ('[]', '{}', 'null'))
  OR EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type = 'SHIPMENT' AND a.entity_id = s.id AND a.action = 'UPDATE')
  OR EXISTS (SELECT 1 FROM documents d WHERE d.shipment_id = s.id)
  OR EXISTS (SELECT 1 FROM user_sto_contract_assignments u JOIN contracts c ON c.contract_id = u.contract_number
             WHERE c.id = s.contract_id AND BTRIM(u.sto_number::text) = BTRIM(s.shipment_id))
)`;

const QUERIES = [
  [
    'A  operation_id by kind x official STO x status',
    String.raw`SELECT ${KIND} AS kind, (s.shipment_id ~ '^[0-9]{10}$') AS official_sto, COALESCE(s.status, '-') AS status, count(*)::int AS rows
               FROM shipments s GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  ],
  [
    'B  EMPTY rows: with / without other KLIP activity',
    String.raw`SELECT (${OTHER_ACTIVITY}) AS has_real_klip_activity, (s.shipment_id ~ '^[0-9]{10}$') AS official_sto, count(*)::int AS rows
               FROM shipments s WHERE NULLIF(BTRIM(s.operation_id), '') IS NULL GROUP BY 1, 2 ORDER BY 1, 2`,
  ],
  [
    'C  rows protected from SAP overwrite by operation_id ALONE (today)',
    String.raw`SELECT ${KIND} AS kind, count(*)::int AS rows
               FROM shipments s
               WHERE NULLIF(BTRIM(s.operation_id), '') IS NOT NULL
                 AND to_jsonb(s)->>'operation_id_source' IS DISTINCT FROM 'SAP_IMPORT'
                 AND NOT ${OTHER_ACTIVITY} GROUP BY 1 ORDER BY 1`,
  ],
  [
    'H  operation_id_source (SAP_IMPORT = id KLIP gave a SAP-imported row; ignored by the SAP re-import protection). Column is read via to_jsonb: works before migration 236 too',
    String.raw`SELECT COALESCE(to_jsonb(s)->>'operation_id_source', '(none: user / older)') AS source, ${KIND} AS kind, count(*)::int AS rows
               FROM shipments s GROUP BY 1, 2 ORDER BY 1, 2`,
  ],
  [
    'D  operation ids shared by more than one STO',
    String.raw`SELECT count(*)::int AS ids,
                      COALESCE(sum(stos), 0)::int AS stos_involved,
                      COALESCE(sum(empty_sibling_rows), 0)::int AS empty_rows_that_could_wrongly_adopt
               FROM (
                 SELECT o.operation_id, count(DISTINCT o.shipment_id) AS stos,
                        (SELECT count(*) FROM shipments e WHERE NULLIF(BTRIM(e.operation_id), '') IS NULL
                            AND e.shipment_id IN (SELECT shipment_id FROM shipments x WHERE x.operation_id = o.operation_id)) AS empty_sibling_rows
                 FROM shipments o WHERE o.operation_id ~ '^OP-' GROUP BY o.operation_id HAVING count(DISTINCT o.shipment_id) > 1
               ) z`,
  ],
  [
    'E  STOs with more than one id among their rows',
    String.raw`SELECT count(*)::int AS stos_with_several_ids FROM (
                 SELECT shipment_id FROM shipments WHERE NULLIF(BTRIM(operation_id), '') IS NOT NULL
                 GROUP BY shipment_id HAVING count(DISTINCT operation_id) > 1) z`,
  ],
  [
    'E2 number ids that point at ANOTHER STO (first 25)',
    String.raw`SELECT s.shipment_id AS sto, s.operation_id AS op_is_number_of, COALESCE(s.status, '-') AS status,
                      (SELECT c.contract_id FROM contracts c WHERE c.id = s.contract_id) AS contract
               FROM shipments s WHERE s.operation_id ~ '^[0-9]+$' AND s.operation_id <> s.shipment_id ORDER BY s.shipment_id LIMIT 25`,
  ],
  [
    'F  assignments keyed by an operation id',
    String.raw`SELECT CASE WHEN u.sto_number ~ '^OP-' THEN 'OP-...' WHEN u.sto_number ~ '^(MNL-|MSEA-)' THEN 'manual id' WHEN u.sto_number ~ '^[0-9]{10}$' THEN '10-digit STO' ELSE 'other' END AS key_kind,
                      count(*)::int AS rows
               FROM user_sto_contract_assignments u GROUP BY 1 ORDER BY 1`,
  ],
  [
    'G  trucking_operations without operation_id',
    String.raw`SELECT count(*) FILTER (WHERE NULLIF(BTRIM(operation_id), '') IS NULL)::int AS empty, count(*)::int AS total FROM trucking_operations`,
  ],
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '120s'");
    for (const [title, sql] of QUERIES) {
      const t0 = Date.now();
      const res = await client.query(sql);
      console.log(`\n== ${title}  (${res.rows.length} rows, ${Date.now() - t0} ms) ==`);
      for (const r of res.rows) console.log(Object.values(r).map((v) => (v === null ? '-' : String(v))).join(' | '));
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
