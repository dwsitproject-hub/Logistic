/**
 * READ-ONLY. How real is the daily "Missing ETA - Cargo Ready Within 14 Days" email?
 *
 * The email (backend/src/services/contractEtaReminder.service.ts) lists every contract whose raw SAP GR status is Open, whose Cargo
 * Readiness Date is within 14 days or already past, and which has no ETA on its shipment / trucking record. "Open" there is the RAW SAP
 * status. Contract Performance also treats a contract as finished when OS is zero, an ATC at discharge is filled, or every vessel STO
 * is finished (isContractEffectivelyDone). A contract that is done by that rule but still GR Open is mailed every morning as
 * "overdue by N days" although nobody has anything left to plan.
 *
 * This script runs the email's own SQL, looks every contract up in the Contract Performance rows, and says how many of the mailed
 * contracts are in fact finished. Nothing is written and no email is sent.
 *
 * Needs no deploy: it calls the code ALREADY inside the running backend image (dist/), so it can be piped in straight from a branch.
 * Run it outside 06:00-10:00 WIB (SAP import window): it loads the Contract Performance rows once, like opening the page cold.
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/diag-eta-reminder-reality.cjs \
 *     | docker exec -i klip-backend node -
 *
 * Options (all optional):
 *   --rows            also print every mailed contract, tab separated (redirect to a file: ... node - --rows > eta.tsv)
 *   --from=YYYY-MM-DD start of the Contract Performance date range used for the lookup (default 2024-01-01)
 *   --to=YYYY-MM-DD   end of that range (default today)
 *   --selftest        run the classification on made-up rows, no database
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const has = (name) => process.argv.includes(`--${name}`);
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const mt = (kg) => {
  const n = Number(kg);
  return Number.isFinite(n) ? (Math.round(n) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '-';
};
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '-');
const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}%` : '-');

/** Why Contract Performance calls this row finished (same three arms as isContractEffectivelyDone). */
function doneReason(row, toleranceKg) {
  const os = Number(row.outstanding_quantity);
  if (Number.isFinite(os) && os <= toleranceKg) return 'OS nol';
  if (row.vessel_stos_finished === true) return 'semua STO kapal selesai';
  return 'ATC terisi';
}

/**
 * One mailed contract against the Contract Performance rows that carry its contract_id.
 * DONE only when every row says CLOSE; one open row keeps it open (the conservative side: it stays in the email).
 */
function classify(cpRows, resolveStatus, toleranceKg) {
  if (!cpRows || cpRows.length === 0) return { verdict: 'NOT_IN_CP' };
  const states = cpRows.map((r) => resolveStatus(r));
  if (states.every((s) => s === 'CANCELLED' || s === 'CANCELED' || s === 'CANCEL')) return { verdict: 'CANCELLED' };
  if (states.every((s) => s === 'CLOSE' || s === 'CLOSED' || s === 'CANCELLED' || s === 'CANCELED' || s === 'CANCEL')) {
    return { verdict: 'DONE', reason: doneReason(cpRows.find((r, i) => states[i] === 'CLOSE' || states[i] === 'CLOSED') || cpRows[0], toleranceKg) };
  }
  return { verdict: 'STILL_OPEN' };
}

function bucket(daysToReadiness) {
  const d = Number(daysToReadiness);
  if (!Number.isFinite(d)) return '?';
  if (d >= 0) return 'belum lewat (0-14 hari lagi)';
  const late = -d;
  if (late <= 30) return 'terlambat 1-30 hari';
  if (late <= 90) return 'terlambat 31-90 hari';
  if (late <= 180) return 'terlambat 91-180 hari';
  return 'terlambat > 180 hari';
}
const BUCKETS = [
  'belum lewat (0-14 hari lagi)',
  'terlambat 1-30 hari',
  'terlambat 31-90 hari',
  'terlambat 91-180 hari',
  'terlambat > 180 hari',
];

function tally(items, keyFn) {
  const m = new Map();
  for (const it of items) m.set(keyFn(it), (m.get(keyFn(it)) || 0) + 1);
  return m;
}

function selftest() {
  const TOL = 1;
  const status = (r) => (r.cancelled ? 'CANCELLED' : r.done ? 'CLOSE' : 'OPEN');
  const ok = (name, cond) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
    if (!cond) process.exitCode = 1;
  };
  ok('no CP row -> NOT_IN_CP', classify([], status, TOL).verdict === 'NOT_IN_CP');
  ok('open row -> STILL_OPEN', classify([{ done: false }], status, TOL).verdict === 'STILL_OPEN');
  ok('one open one closed -> STILL_OPEN (stays in the email)', classify([{ done: true }, { done: false }], status, TOL).verdict === 'STILL_OPEN');
  ok('all cancelled -> CANCELLED', classify([{ cancelled: true }], status, TOL).verdict === 'CANCELLED');
  const d1 = classify([{ done: true, outstanding_quantity: 0 }], status, TOL);
  ok('OS zero -> DONE / OS nol', d1.verdict === 'DONE' && d1.reason === 'OS nol');
  const d2 = classify([{ done: true, outstanding_quantity: 5000, vessel_stos_finished: true }], status, TOL);
  ok('vessel STOs finished -> DONE / semua STO kapal selesai', d2.verdict === 'DONE' && d2.reason === 'semua STO kapal selesai');
  const d3 = classify([{ done: true, outstanding_quantity: 5000 }], status, TOL);
  ok('else the ATC arm -> DONE / ATC terisi', d3.verdict === 'DONE' && d3.reason === 'ATC terisi');
  ok('bucket: -304 -> > 180', bucket(-304) === 'terlambat > 180 hari');
  ok('bucket: 5 -> not yet', bucket(5) === 'belum lewat (0-14 hari lagi)');
  ok('bucket: -30 / -31', bucket(-30) === 'terlambat 1-30 hari' && bucket(-31) === 'terlambat 31-90 hari');
}

(async () => {
  if (has('selftest')) {
    selftest();
    return;
  }

  const pool = dist('database/connection').default;
  const { buildContractsMissingEtaNearCargoReadinessSql } = dist('utils/missingEtaAlertSql');
  const lp = dist('services/latePerformance.service');
  const { resolveContractEffectiveStatusText } = dist('utils/contractDeliveryStatus');
  const { OUTSTANDING_QTY_ZERO_TOLERANCE_KG } = dist('utils/qtyZeroTolerance');
  const { findEtaReminderRecipients } = dist('services/contractEtaReminder.service');

  const from = arg('from', '2024-01-01');
  const to = arg('to', new Date().toISOString().slice(0, 10));

  // ---- which environment is this, and who would get the mail
  console.log('== Lingkungan');
  console.log(`FRONTEND_URL                         ${process.env.FRONTEND_URL || process.env.APP_PUBLIC_ORIGIN || '(kosong)'}`);
  console.log(`DB                                   ${process.env.DB_HOST || '(?)'} / ${process.env.DB_NAME || '(?)'}`);
  console.log(`CONTRACT_ETA_REMINDER_ENABLED        ${process.env.CONTRACT_ETA_REMINDER_ENABLED ?? '(tidak diset: default true)'}`);
  console.log(`CONTRACT_ETA_REMINDER_EXTRA_RECIPIENTS ${process.env.CONTRACT_ETA_REMINDER_EXTRA_RECIPIENTS || '(kosong)'}`);
  const recipients = await findEtaReminderRecipients();
  console.log(`penerima dari tabel users (${recipients.length}): ${recipients.map((r) => r.email).join('; ') || '-'}`);
  const fresh = await pool.query(`SELECT max(created_at)::text AS last_created, max(last_seen_at)::text AS last_seen FROM sap_processed_data`);
  console.log(`sap_processed_data terakhir          dibuat ${fresh.rows[0].last_created}   terlihat ${fresh.rows[0].last_seen}`);
  console.log(`hari ini di server                   ${new Date().toISOString().slice(0, 10)}\n`);

  // ---- the email's own rows
  const mailed = (await pool.query(buildContractsMissingEtaNearCargoReadinessSql())).rows;
  const distinct = new Set(mailed.map((r) => String(r.contract_id))).size;
  console.log('== Isi email (SQL yang sama persis)');
  console.log(`baris di email: ${mailed.length}   kontrak unik: ${distinct}`);
  console.log(`  moda     ${[...tally(mailed, (r) => String(r.transport_mode || '-').toUpperCase())].map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`  ETA hilang  Shipment=${mailed.filter((r) => r.sea_missing_eta).length}  Trucking=${mailed.filter((r) => r.land_missing_eta).length}\n`);

  // ---- Contract Performance rows, loaded once like the page does cold
  const user = { id: 'diag', role: 'ADMIN', permissions: ['*'] };
  const filters = lp.parseLatePerformanceFilters({ query: { scope: 'filtered', dateFrom: from, dateTo: to }, user }, 'all');
  const started = Date.now();
  const cpRows = await lp.loadLatePerformanceRows(filters);
  console.log(`== Contract Performance: ${cpRows.length} baris dimuat (${from}..${to}) dalam ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const byContract = new Map();
  for (const r of cpRows) {
    const k = String(r.contract_id ?? '');
    if (!byContract.has(k)) byContract.set(k, []);
    byContract.get(k).push(r);
  }

  const judged = mailed.map((m) => {
    const rows = byContract.get(String(m.contract_id));
    const c = classify(rows, resolveContractEffectiveStatusText, OUTSTANDING_QTY_ZERO_TOLERANCE_KG);
    const first = rows && rows[0];
    return {
      ...m,
      ...c,
      bucket: bucket(m.days_to_cargo_readiness),
      osKg: first ? lp.resolveOpenPerfOutstandingQtyKg(first) : null,
      atc: first ? first.last_ata_vessel_complete_discharge : null,
      grStatus: first ? first.import_status : null,
    };
  });

  const n = judged.length;
  const done = judged.filter((j) => j.verdict === 'DONE');
  const open = judged.filter((j) => j.verdict === 'STILL_OPEN');
  const cancelled = judged.filter((j) => j.verdict === 'CANCELLED');
  const notIn = judged.filter((j) => j.verdict === 'NOT_IN_CP');

  console.log('\n== Penilaian aturan Contract Performance atas baris email');
  console.log(`masih open (layak di email)          ${String(open.length).padStart(5)}  ${pct(open.length, n)}`);
  console.log(`sebenarnya SELESAI menurut CP        ${String(done.length).padStart(5)}  ${pct(done.length, n)}`);
  for (const [k, v] of tally(done, (j) => j.reason)) console.log(`   - ${k.padEnd(28)} ${String(v).padStart(5)}`);
  console.log(`dibatalkan                           ${String(cancelled.length).padStart(5)}  ${pct(cancelled.length, n)}`);
  console.log(`tidak ada di Contract Performance    ${String(notIn.length).padStart(5)}  ${pct(notIn.length, n)}   (tanpa region/site, atau di luar rentang tanggal; tidak bisa dinilai)`);

  console.log('\n== Umur keterlambatan: email sekarang vs yang tersisa bila memakai aturan CP');
  console.log(['rentang'.padEnd(32), 'email'.padStart(6), 'tersisa'.padStart(8), 'selesai'.padStart(8)].join(' '));
  for (const b of BUCKETS) {
    const all = judged.filter((j) => j.bucket === b);
    const rest = all.filter((j) => j.verdict === 'STILL_OPEN' || j.verdict === 'NOT_IN_CP');
    const fin = all.filter((j) => j.verdict === 'DONE' || j.verdict === 'CANCELLED');
    console.log([b.padEnd(32), String(all.length).padStart(6), String(rest.length).padStart(8), String(fin.length).padStart(8)].join(' '));
  }
  const kept = open.length + notIn.length;
  console.log(`\nemail setelah aturan CP: ${kept} baris (dari ${n}); ${done.length + cancelled.length} baris hilang karena sudah selesai/batal.`);

  const oldestOpen = open.slice().sort((a, b) => Number(a.days_to_cargo_readiness) - Number(b.days_to_cargo_readiness)).slice(0, 15);
  console.log('\n== 15 terlama yang MASIH open (ini yang benar-benar perlu ETA)');
  console.log(['kontrak', 'ext_no', 'supplier', 'produk', 'moda', 'cargo_ready', 'hari', 'OS_MT', 'GR'].join('\t'));
  for (const j of oldestOpen) {
    console.log([j.contract_id, j.contract_ext_no ?? '', j.supplier ?? '', j.product ?? '', j.transport_mode ?? '', j.cargo_readiness_date, j.days_to_cargo_readiness, mt(j.osKg), j.grStatus ?? ''].join('\t'));
  }

  const sampleDone = done.slice().sort((a, b) => Number(a.days_to_cargo_readiness) - Number(b.days_to_cargo_readiness)).slice(0, 10);
  console.log('\n== 10 contoh yang sudah SELESAI tetapi tetap muncul di email');
  console.log(['kontrak', 'supplier', 'produk', 'cargo_ready', 'hari', 'alasan', 'OS_MT', 'ATC', 'GR'].join('\t'));
  for (const j of sampleDone) {
    console.log([j.contract_id, j.supplier ?? '', j.product ?? '', j.cargo_readiness_date, j.days_to_cargo_readiness, j.reason, mt(j.osKg), day(j.atc), j.grStatus ?? ''].join('\t'));
  }

  if (has('rows')) {
    console.log('\n== SEMUA baris email (TSV)');
    console.log(['contract_id', 'ext_no', 'po', 'supplier', 'product', 'incoterm', 'mode', 'sea_missing', 'land_missing', 'cargo_ready', 'days', 'bucket', 'verdict', 'reason', 'os_mt', 'atc', 'gr'].join('\t'));
    for (const j of judged) {
      console.log([j.contract_id, j.contract_ext_no ?? '', j.po_number ?? '', j.supplier ?? '', j.product ?? '', j.incoterm ?? '', j.transport_mode ?? '', j.sea_missing_eta, j.land_missing_eta, j.cargo_readiness_date, j.days_to_cargo_readiness, j.bucket, j.verdict, j.reason ?? '', mt(j.osKg), day(j.atc), j.grStatus ?? ''].join('\t'));
    }
  }

  await pool.end();
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
