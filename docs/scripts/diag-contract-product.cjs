/**
 * READ-ONLY. Where does a contract's Product come from, at every stage between the SAP file and the screen?
 *
 * "KLIP shows POME, SAP says WASTE OIL (POME)". The SAP import writes contracts.product straight from the SAP
 * row (sapDataDistribution.upsertContract: product = COALESCE(new, old)) and no screen rewrites it, so a
 * difference has to enter at one of four places. This prints all four side by side:
 *
 *   1. sap_raw_data            what SAP's file literally said, per import (every key that looks like a product)
 *   2. sap_processed_data      what the importer parsed from it (column + data->contract->product)
 *   3. contracts               what the screens read (and when the row last changed)
 *   4. contract_performance_snapshot   what Contract Performance reads
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-contract-product.cjs \
 *     | docker exec -i klip-backend node - --contract=1601000176
 *
 * Matches the number as contract number OR PO number. Nothing is written.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const show = (title, rows) => {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (rows.length === 0) console.log('  (none)');
  for (const r of rows) console.log(' ', JSON.stringify(r));
};

(async () => {
  const key = arg('contract');
  if (!key) {
    console.error('Give --contract=<contract number or PO number>.');
    process.exit(1);
  }
  const pool = dist('database/connection').default;
  try {
    const contracts = await pool.query(
      `SELECT id, contract_id, po_number, product, source_type, created_at, updated_at
         FROM contracts
        WHERE contract_id = $1 OR po_number = $1
        ORDER BY created_at`,
      [key],
    );
    show('contracts', contracts.rows);

    const ids = contracts.rows.map((r) => r.contract_id);
    const snapshot = await pool.query(
      `SELECT contract_id, product
         FROM contract_performance_snapshot
        WHERE contract_id = ANY($1::text[]) OR contract_id = $2`,
      [ids, key],
    );
    show('contract_performance_snapshot', snapshot.rows);

    const processed = await pool.query(
      `SELECT spd.import_id, spd.contract_number, spd.po_number, spd.sto_number, spd.product,
              spd.data->'contract'->>'product' AS data_contract_product,
              spd.last_seen_at
         FROM sap_processed_data spd
        WHERE spd.contract_number = $1 OR spd.po_number = $1
        ORDER BY spd.last_seen_at DESC NULLS LAST
        LIMIT 40`,
      [key],
    );
    show('sap_processed_data (latest first, max 40)', processed.rows);

    const distinct = await pool.query(
      `SELECT COALESCE(spd.product, '<NULL>') AS product, COUNT(*)::int AS rows,
              MIN(spd.last_seen_at) AS first_seen, MAX(spd.last_seen_at) AS last_seen
         FROM sap_processed_data spd
        WHERE spd.contract_number = $1 OR spd.po_number = $1
        GROUP BY 1
        ORDER BY 4 DESC NULLS LAST`,
      [key],
    );
    show('sap_processed_data: distinct product values', distinct.rows);

    const raw = await pool.query(
      `SELECT r.import_id, r.row_number, r.created_at,
              CASE WHEN jsonb_typeof(r.data) = 'object' THEN
                (SELECT jsonb_object_agg(k, v)
                   FROM jsonb_each_text(r.data) AS e(k, v)
                  WHERE k ILIKE '%product%' OR k ILIKE '%material%')
              ELSE to_jsonb(left(r.data::text, 300)) END AS product_like_fields
         FROM sap_raw_data r
        WHERE r.data::text LIKE '%' || $1 || '%'
        ORDER BY r.created_at DESC
        LIMIT 20`,
      [key],
    );
    show('sap_raw_data (latest first, max 20)', raw.rows);
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
