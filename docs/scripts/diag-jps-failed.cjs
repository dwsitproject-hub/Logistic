/*
 * READ-ONLY: which STOs did JPS refuse and are STILL refused - and which of them were refused for a master-vessel LOA that JPS no longer requires?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-jps-failed.cjs | docker exec -i klip-backend node -
 *
 * JPS update of 2026-10-27 (API still 5.6): a blank master LOA / GT / draft is stored null and no longer refuses the submit; only a value that is present but not a positive number is.
 * An STO KLIP recorded as FAILED ("Master vessel LOA is missing") is NOT sent again by itself: FAILED holds it, and JPS_RETRY_FAILED is off by design. Once JPS confirms the change is live,
 * send each one again with the Submit to Jetty button (Edit Shipment) - a refused STO is retried under the same reference, so JPS never holds two - or switch JPS_RETRY_FAILED on for a
 * while and off again.
 *
 * Lists every STO whose newest tracker row is FAILED (an STO that has a SUBMITTED row is not listed: JPS holds it), the reason JPS gave, when, and whether the reason is the LOA one.
 * Writes nothing.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));

(async () => {
  const pool = load('database/connection').default;
  const { isJpsEnabled, jpsRetryFailed } = load('jps/config');
  console.log(`JPS enabled: ${isJpsEnabled()}   JPS_RETRY_FAILED: ${jpsRetryFailed()}\n`);

  const r = await pool.query(
    `SELECT DISTINCT ON (j.sto_key)
            j.sto_key, j.revision, j.last_error, j.request_id, j.updated_at,
            j.payload->>'vessel_hub_code' AS vessel_hub_code,
            (j.last_error ILIKE '%LOA%') AS loa_reason
       FROM jps_shipping_instructions j
      WHERE j.state IN ('FAILED', 'SUBMITTED', 'SKIPPED_NO_CARGO', 'SKIPPED_PRE_EXISTING')
        AND NOT EXISTS (SELECT 1 FROM jps_shipping_instructions s WHERE s.sto_key = j.sto_key AND s.state IN ('SUBMITTED', 'SKIPPED_PRE_EXISTING'))
        AND j.state = 'FAILED'
      ORDER BY j.sto_key, j.revision DESC`,
  );
  const rows = r.rows;
  const loa = rows.filter((x) => x.loa_reason);
  console.log(`STOs still refused by JPS: ${rows.length}   (for the LOA reason: ${loa.length}, other reasons: ${rows.length - loa.length})\n`);

  const day = (v) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '-');
  const show = (title, list) => {
    if (list.length === 0) return;
    console.log(title);
    for (const x of list) {
      console.log(`  ${String(x.sto_key).padEnd(26)} R${x.revision}  ${day(x.updated_at)}  vessel ${x.vessel_hub_code || '-'}  req ${x.request_id || '-'}`);
      console.log(`      ${String(x.last_error || '').slice(0, 220)}`);
    }
    console.log('');
  };
  show('Refused for the LOA: send again once JPS confirms the update is live (Submit to Jetty):', loa);
  show('Refused for another reason: still needs a fix first (the reason says what):', rows.filter((x) => !x.loa_reason));
  if (rows.length === 0) console.log('Nothing is waiting: no STO is currently refused.');
  await pool.end();
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.stack ? e.stack : e).slice(0, 400));
  process.exit(1);
});
