/*
 * Pull DHM's whole commodity catalog into Master Product (products), from the start, ignoring the pull cursor. Dry run by default.
 *
 *   docker exec -i klip-backend node - < pull-dhm-commodities.cjs                 (dry run: reads DHM and counts, writes nothing)
 *   docker exec -i -e APPLY=1 klip-backend node - < pull-dhm-commodities.cjs      (writes)
 *
 * WHY. Production's products held 25 KLIP-made rows and none from DHM, although DHM serves its commodity catalog (checked 2026-11-16: /v1/sync/commodity answers 100 records a page,
 * each with material_code, type, long_name, uom). The cron pull keeps a cursor per entity (dhm_sync_state) and the cursor on production stands at 2026-10-21, but an earlier pull ran
 * on code from before products had material_code / commodity_type / material_group / hs_code / uom, so applying a record failed, the record was skipped (continueOnError) and the
 * cursor moved on: the catalog was never stored and an incremental pull never asks for it again. This pulls it again from the beginning with the code in force now.
 *
 * It is exactly what the cron does for 'commodity' (the same applyDhmMasterRecord), only from a null cursor, and only for commodity: no other master (company, plant, port,
 * incoterm...) is touched. A record matches an existing product by dhm_id, code_dhm, material_code, then name, and fills what that row lacks (COALESCE); otherwise it is a new row.
 * With APPLY it also removes the "DHM commodity needs material_code" push states of products that came from DHM and carry the code now (the same clean-up as migration 266).
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) { console.error('no backend build found'); process.exit(1); }
const load = (m) => require(path.join(DIST, m));
const APPLY = process.env.APPLY === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await load('integrations/settingsStore').loadIntegrationSettings();
  const { query } = load('database/connection');
  const { isDhmEnabled } = load('dhm/config');
  if (!isDhmEnabled()) { console.log('DHM is not enabled here.'); process.exit(1); }
  const { dhmRequest } = load('dhm/client');
  const { applyDhmMasterRecord } = load('dhm/applyMaster');
  const { saveDhmSyncCursor } = load('dhm/replica');

  const before = (await query(`SELECT count(*)::int total, count(*) FILTER (WHERE dhm_id IS NOT NULL)::int from_dhm FROM products`)).rows[0];
  console.log(APPLY ? 'APPLY: writing to products' : 'DRY RUN: nothing is written (add -e APPLY=1 to write)');
  console.log('products before:', before);

  let cursor = null;
  let pages = 0;
  let seen = 0, withCode = 0, deleted = 0, applied = 0, notWritten = 0, wouldMatch = 0, wouldInsert = 0;
  const errors = [];
  let newestUpdatedAt = null;
  const text = (d, k) => (d && d[k] != null && String(d[k]).trim() !== '' ? String(d[k]).trim() : null);

  for (;;) {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (cursor) params.set('cursor', cursor);
    const { status, data } = await dhmRequest({ method: 'GET', url: `/v1/sync/commodity?${params.toString()}` });
    if (status === 429) { console.log('DHM answered 429 (rate limit); stopped. Run again: the cursor saved so far is kept.'); break; }
    if (status !== 200) { console.log('DHM answered', status, '- stopped.'); break; }
    pages += 1;
    const records = Array.isArray(data && data.records) ? data.records : [];
    for (const record of records) {
      seen += 1;
      if (record.isDeleted) deleted += 1;
      if (text(record.data, 'material_code')) withCode += 1;
      if (record.updatedAt && (!newestUpdatedAt || record.updatedAt > newestUpdatedAt)) newestUpdatedAt = record.updatedAt;
      if (!APPLY) {
        const m = await query(
          `SELECT 1 FROM products WHERE dhm_id = $1::uuid OR code_dhm = $2 OR upper(trim(product_name)) = upper(trim($3))
              OR ($4::text IS NOT NULL AND upper(trim(material_code)) = upper(trim($4))) LIMIT 1`,
          [record.id, text(record.data, 'code'), text(record.data, 'short_name') || text(record.data, 'name') || '', text(record.data, 'material_code')],
        );
        if (m.rows.length) wouldMatch += 1; else wouldInsert += 1;
        continue;
      }
      try {
        const written = await applyDhmMasterRecord('commodity', record, {});
        if (written === false) notWritten += 1; else applied += 1;
      } catch (e) {
        if (errors.length < 8) errors.push(`${text(record.data, 'code') || record.id}: ${e && e.message ? e.message : e}`);
        notWritten += 1;
      }
    }
    const nextCursor = data && data.nextCursor ? data.nextCursor : null;
    // The cursor only moves while every record was written: that is the bug being repaired (a pull that failed to write moved the cursor on, so the records were never asked for again).
    if (APPLY && nextCursor && notWritten === 0) await saveDhmSyncCursor('commodity', nextCursor, newestUpdatedAt);
    const next = data && data.hasMore && nextCursor ? nextCursor : null;
    if (pages % 5 === 0) console.log(`  ... page ${pages}, ${seen} records`);
    if (!next) break;
    cursor = next;
    if (pages > 200) { console.log('stopped after 200 pages'); break; }
    await sleep(250);
  }

  console.log(`\npages ${pages}, records ${seen} (deleted at DHM: ${deleted}, with material_code: ${withCode})`);
  if (!APPLY) {
    console.log(`would update an existing row: ${wouldMatch}   would insert a new row: ${wouldInsert}`);
  } else {
    console.log(`applied ${applied}, not written ${notWritten}`);
    if (errors.length) { console.log('first errors:'); errors.forEach((e) => console.log('  -', e)); }
    const cleared = await query(
      `DELETE FROM dhm_push_state s USING products p
        WHERE s.entity_kind = 'product' AND s.entity_id = p.id AND s.error ILIKE 'DHM commodity needs material_code%'
          AND p.dhm_id IS NOT NULL AND NULLIF(trim(p.material_code), '') IS NOT NULL`,
    );
    console.log('push states cleared (came from DHM, code present):', cleared.rowCount);
    const after = (await query(`SELECT count(*)::int total, count(*) FILTER (WHERE dhm_id IS NOT NULL)::int from_dhm,
                                       count(*) FILTER (WHERE NULLIF(trim(material_code), '') IS NOT NULL)::int with_material_code FROM products`)).rows[0];
    console.log('products after:', after);
    const left = (await query(`SELECT count(*)::int n FROM dhm_push_state WHERE entity_kind = 'product' AND status = 'FAILED'`).catch(() => ({ rows: [{ n: '?' }] }))).rows[0].n;
    console.log('product push states still FAILED:', left);
  }
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e && e.message ? e.message : e); process.exit(1); });
