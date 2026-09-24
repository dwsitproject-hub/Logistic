/*
 * READ-ONLY: why is this STO not being sent to the Jetty Planning System?
 *
 *   node /app/diag-jps-eligibility.cjs OP-1014003242-54431632
 *   node /app/diag-jps-eligibility.cjs 1006020146 1006020075
 *
 * WHY THIS EXISTS. "I filled in ATC and nothing was sent" has six possible causes and the log says
 * nothing about five of them, because a shipment that fails the rule is never logged at all - it
 * simply does not appear in the eligibility query. This prints every condition for the STO named,
 * with the value that decided it, so the answer is read rather than guessed.
 *
 * It checks the integration switch first. `isJpsEnabled()` needs JPS_ENABLED=true AND a base URL
 * AND an API key; with any one missing, runJpsSync returns on its first line and no amount of
 * correct data will send anything.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) =>
  fs.existsSync(p),
);
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const load = (m) => require(path.join(DIST, m));
const connection = load('database/connection');
const { isJpsEnabled, jpsRegionSite } = load('jps/config');

const KEYS = process.argv.slice(2).filter(Boolean);
if (KEYS.length === 0) {
  console.error('usage: node diag-jps-eligibility.cjs <sto_or_operation_id> [...]');
  process.exit(1);
}

const yn = (ok) => (ok ? 'YA ' : 'TIDAK');

(async () => {
  console.log('');
  console.log('=== saklar integrasi');
  console.log(`   JPS_ENABLED        : ${process.env.JPS_ENABLED || '(kosong)'}`);
  console.log(`   JPS_API_BASE_URL   : ${process.env.JPS_API_BASE_URL || '(kosong)'}`);
  console.log(`   JPS_API_KEY        : ${process.env.JPS_API_KEY ? '(terisi)' : '(kosong)'}`);
  console.log(`   JPS_REGION_SITE    : ${jpsRegionSite()}`);
  console.log(`   => isJpsEnabled()  : ${isJpsEnabled()}`);
  if (!isJpsEnabled()) {
    console.log('');
    console.log('   Integrasi MATI. runJpsSync keluar di baris pertama, jadi tidak ada yang');
    console.log('   dikirim apa pun kondisi datanya. Setel ketiganya lalu deploy ulang backend.');
  }

  for (const key of KEYS) {
    const res = await connection.query(
      `SELECT s.id, s.shipment_id, s.operation_id, s.status, s.port_of_discharge,
              s.eta_discharge_arrival, s.eta_discharge_complete,
              COALESCE(sao.ata_loading_complete,   s.ata_loading_complete)   AS atc_loading,
              COALESCE(sao.ata_discharge_arrival,  s.ata_discharge_arrival)  AS ata_arrival,
              COALESCE(sao.ata_discharge_berthed,  s.ata_discharge_berthed)  AS ata_berthed,
              COALESCE(sao.ata_discharge_start,    s.ata_discharge_start)    AS ata_start,
              COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete) AS ata_complete,
              (SELECT UPPER(TRIM(COALESCE(l.discharge_destination, '')))
                 FROM contracts c
                 JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
                WHERE c.id = s.contract_id LIMIT 1) AS region_site,
              (SELECT COUNT(*)::int FROM contract_stos cs
                WHERE UPPER(TRIM(cs.sto_number)) =
                      UPPER(COALESCE(NULLIF(TRIM(s.shipment_id), ''), NULLIF(TRIM(s.operation_id), '')))
              ) AS cargo_lines,
              (SELECT j.state || ' / ' || COALESCE(j.jps_status, '-') || COALESCE(' / ' || j.last_error, '')
                 FROM jps_shipping_instructions j
                WHERE j.sto_key = COALESCE(NULLIF(TRIM(s.shipment_id), ''), NULLIF(TRIM(s.operation_id), ''))
                ORDER BY j.revision DESC LIMIT 1) AS tracker
       FROM shipments s
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
       WHERE UPPER(TRIM(COALESCE(s.shipment_id, ''))) = UPPER($1)
          OR UPPER(TRIM(COALESCE(s.operation_id, ''))) = UPPER($1)`,
      [key],
    );

    console.log('');
    console.log(`=== ${key}`);
    if (res.rows.length === 0) {
      console.log('   tidak ada baris shipment dengan STO / operation id ini');
      continue;
    }

    for (const r of res.rows) {
      const wantRegion = jpsRegionSite();
      const checks = [
        [`Region/Site = ${wantRegion}`, String(r.region_site || '') === wantRegion, r.region_site || '(kosong)'],
        ['ATC Loading terisi', r.atc_loading != null, r.atc_loading || '(kosong)'],
        ['belum ada ATA discharge', !r.ata_arrival && !r.ata_berthed && !r.ata_start && !r.ata_complete,
          [r.ata_arrival, r.ata_berthed, r.ata_start, r.ata_complete].filter(Boolean).join(', ') || '(semua kosong)'],
        ['status bukan COMPLETED/CANCELLED', !['COMPLETED', 'CANCELLED'].includes(String(r.status || '').toUpperCase()), r.status || '(kosong)'],
        ['ETA discharge arrival terisi', r.eta_discharge_arrival != null, r.eta_discharge_arrival || '(kosong)'],
        ['punya baris cargo (contract_stos)', Number(r.cargo_lines) > 0, `${r.cargo_lines} baris`],
        ['belum ada di pelacak', !r.tracker, r.tracker || '(belum ada)'],
      ];
      console.log(`   shipment ${r.id}  STO=${r.shipment_id || '-'}  OP=${r.operation_id || '-'}`);
      for (const [label, ok, value] of checks) {
        console.log(`     [${yn(ok)}] ${label.padEnd(34)} ${value}`);
      }
      const failed = checks.filter(([, ok]) => !ok).map(([l]) => l);
      console.log(
        failed.length === 0
          ? '     => memenuhi semua syarat; jalankan runJpsSync dan lihat lognya'
          : `     => TERTAHAN oleh: ${failed.join(' | ')}`,
      );
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.stack ? e.stack : e).slice(0, 400));
  process.exit(1);
});
