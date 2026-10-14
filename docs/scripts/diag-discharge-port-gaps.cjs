/*
 * READ-ONLY: which SAP discharge-port texts reach a Master Port, and which Master Ports are missing.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-discharge-port-gaps.cjs | docker exec -i klip-backend node -
 *
 * One SELECT inside a read-only transaction that is rolled back; nothing is written. Needs no password: it uses the backend container's own connection.
 *
 * WHY. SAP writes the Vessel Discharge Port as free text, often a PLANT's name ("EUP EDIBLE OIL BONTANG"). The Discharge Port filter reads a text as a Master
 * Port by the rule of jps/eligibility.ts: the text is a Master Port (with or without PORT), else a discharge_port_aliases name -> its Site -> the port named
 * exactly "PORT <site>", else it stays what it is. An alias whose Site has no such Master Port reaches nothing, and that is Master Port DATA to fill.
 *
 * Output, in this order:
 *   A summary                    texts and uses per source (shipment, leg, backlog) and how far they get
 *   B texts with no Master Port  the texts that do not reach a port, most used first
 *   C Master Port to add         the "PORT <site>" ports that would make the aliases resolve
 *   D alias without a Site       aliases with no Site at all
 *
 * Backlog = contracts with no shipment, by the newest SAP row's Vessel Discharge Port; the incoterm test is c.incoterm only, close to the page's scope but not identical.
 */
const path = require('path');
const fs = require('fs');

const DIST = [process.env.KLIP_DIST, '/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].filter(Boolean).find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const pool = require(path.join(DIST, 'database/connection')).default;

// String.raw: the regexes carry backslashes (\s) that must reach Postgres as they are.
const SQL = String.raw`
WITH
master AS (
  SELECT upper(btrim(port)) AS label,
         coalesce(dhm_is_deleted, false) AS deleted,
         regexp_replace(btrim(regexp_replace(upper(port), '[^A-Z0-9]+', ' ', 'g')), '^(PORT|JETTY|TERMINAL|PELABUHAN|DERMAGA)(\s+OF)?\s+', '') AS id
  FROM master_loading_ports
  WHERE nullif(btrim(port), '') IS NOT NULL
),
master_best AS (
  SELECT DISTINCT ON (id) id, label
  FROM master
  ORDER BY id, deleted, (label LIKE 'PORT %') DESC, length(label), label
),
alias_rows AS (
  SELECT upper(regexp_replace(btrim(a.alias_name), '\s+', ' ', 'g')) AS alias_name,
         regexp_replace(btrim(regexp_replace(upper(a.alias_name), '[^A-Z0-9]+', ' ', 'g')), '^(PORT|JETTY|TERMINAL|PELABUHAN|DERMAGA)(\s+OF)?\s+', '') AS id,
         upper(btrim(s.site_name)) AS site
  FROM discharge_port_aliases a
  LEFT JOIN master_sites s ON s.id = a.site_id
),
alias_res AS (
  SELECT ar.*,
         (SELECT mb.label FROM master m JOIN master_best mb ON mb.id = m.id
           WHERE m.label = 'PORT ' || ar.site ORDER BY m.deleted LIMIT 1) AS resolves_to
  FROM alias_rows ar
),
raw_uses AS (
  SELECT upper(regexp_replace(btrim(s.port_of_discharge), '\s+', ' ', 'g')) AS name, 'shipment' AS src
  FROM shipments s WHERE nullif(btrim(s.port_of_discharge), '') IS NOT NULL
  UNION ALL
  SELECT upper(regexp_replace(btrim(v.port_name), '\s+', ' ', 'g')), 'leg'
  FROM vessel_loading_ports v
  WHERE coalesce(v.is_discharge_port, false) AND NOT coalesce(v.is_cancelled, false) AND nullif(btrim(v.port_name), '') IS NOT NULL
  UNION ALL
  SELECT upper(regexp_replace(btrim(b.p), '\s+', ' ', 'g')), 'backlog'
  FROM (
    SELECT (SELECT nullif(trim(coalesce(spd.data->'raw'->>'Vessel Discharge Port', spd.data->'raw'->>'Vessel Discharge Port ',
                                        spd.data->'shipment'->>'vessel_discharge_port', spd.data->'raw'->>'Port of Discharge',
                                        spd.data->'shipment'->>'port_of_discharge')), '')
            FROM sap_processed_data spd
            WHERE spd.contract_number = c.contract_id
            ORDER BY spd.created_at DESC NULLS LAST LIMIT 1) AS p
    FROM contracts c
    WHERE coalesce(c.sap_presence, 'PRESENT') = 'PRESENT'
      AND upper(btrim(c.incoterm)) IN ('CIF', 'FOB', 'CFR', 'CNF', 'C&F')
      AND NOT EXISTS (SELECT 1 FROM shipments sx WHERE sx.contract_id = c.id)
  ) b
  WHERE b.p IS NOT NULL
),
uses AS (
  SELECT name, src,
         regexp_replace(btrim(regexp_replace(name, '[^A-Z0-9]+', ' ', 'g')), '^(PORT|JETTY|TERMINAL|PELABUHAN|DERMAGA)(\s+OF)?\s+', '') AS id
  FROM raw_uses
),
uses_ok AS (
  SELECT * FROM uses WHERE id !~ '^[0-9 ]*$' AND id NOT IN ('BLANK', 'DISCHARGE PORT')
),
cls AS (
  SELECT u.name, u.src, count(*) AS n,
         CASE WHEN mb.id IS NOT NULL THEN 'MASTER'
              WHEN ar.resolves_to IS NOT NULL THEN 'ALIAS -> PORT'
              WHEN ar.id IS NOT NULL THEN 'ALIAS, SITE HAS NO PORT'
              ELSE 'UNMAPPED' END AS kind,
         ar.site
  FROM uses_ok u
  LEFT JOIN master_best mb ON mb.id = u.id
  LEFT JOIN LATERAL (SELECT * FROM alias_res x WHERE x.id = u.id LIMIT 1) ar ON true
  GROUP BY u.name, u.src, mb.id, ar.id, ar.resolves_to, ar.site
)
SELECT section, c1, c2, c3, c4 FROM (
  SELECT 1 AS ord, 0::numeric AS sub, 'A summary'::text AS section, src::text AS c1, kind::text AS c2,
         count(DISTINCT name)::text AS c3, sum(n)::text AS c4
  FROM cls GROUP BY src, kind
  UNION ALL
  SELECT 2, sum(n), 'B texts with no Master Port', name, kind, coalesce(site, ''),
         sum(n)::text || '  (' || string_agg(src || ':' || n, ', ' ORDER BY src) || ')'
  FROM cls WHERE kind IN ('ALIAS, SITE HAS NO PORT', 'UNMAPPED')
  GROUP BY name, kind, site
  UNION ALL
  SELECT 3, coalesce(sum(c.n), 0), 'C Master Port to add', 'PORT ' || a.site, count(DISTINCT a.alias_name)::text || ' alias(es)',
         string_agg(DISTINCT a.alias_name, ' / '), coalesce(sum(c.n), 0)::text
  FROM alias_res a
  LEFT JOIN cls c ON c.kind = 'ALIAS, SITE HAS NO PORT' AND c.site = a.site AND c.name = a.alias_name
  WHERE a.resolves_to IS NULL AND a.site IS NOT NULL
  GROUP BY a.site
  UNION ALL
  SELECT 4, 0, 'D alias without a Site', alias_name, '', '', ''
  FROM alias_res WHERE site IS NULL
) q
ORDER BY ord, sub DESC, c1
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '180s'");
    const t0 = Date.now();
    const res = await client.query(SQL);
    console.log(`${res.rows.length} rows in ${Date.now() - t0} ms\n`);
    let section = null;
    for (const r of res.rows) {
      if (r.section !== section) {
        section = r.section;
        console.log(`\n== ${section} ==`);
      }
      console.log([r.c1, r.c2, r.c3, r.c4].filter((v) => v !== '' && v != null).join(' | '));
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
