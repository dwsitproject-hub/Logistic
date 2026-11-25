/**
 * READ-ONLY timing of what a Commercial Documents upload leans on, on the real data. Writes nothing (no file is created on the share).
 *
 *   docker cp docs/scripts/diag-commercial-docs-timing.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/diag-commercial-docs-timing.cjs
 *
 * 1. The queries the page runs again after every upload (the table, its count, the summary cards, completeness by plant): the first run and two more,
 *    in ms. If these take seconds, "the upload feels slow" is the refresh behind it, not the upload.
 * 2. The share: stat of recently uploaded files, stat of a file that is not there, listing one PO folder, and reading a real PDF (MB/s). The preview of the
 *    file just uploaded is a read like this; the upload's naming and read-back are stats like these.
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(process.cwd(), 'dist');
const pool = require(path.join(DIST, 'database', 'connection')).default;
const q = require(path.join(DIST, 'utils', 'commercialDocumentsQuerySql'));
const { resolveUploadAbsolutePath } = require(path.join(DIST, 'utils', 'fileUpload'));

const ms = (from) => Math.round(Number(process.hrtime.bigint() - from) / 1e5) / 10;
const stat = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return `n=${s.length} min=${s[0]} median=${s[Math.floor(s.length / 2)]} max=${s[s.length - 1]} ms`;
};

async function timeQuery(label, built) {
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    const t = process.hrtime.bigint();
    await pool.query(built.sql, built.values);
    runs.push(ms(t));
  }
  console.log(`  ${label.padEnd(34)} run1=${runs[0]} ms   run2=${runs[1]} ms   run3=${runs[2]} ms`);
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const scope = { dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: today };

  console.log(`\n=== 1. the queries behind the page (scope: this year ${scope.dateFrom} .. ${scope.dateTo})`);
  const list = q.buildCommercialDocumentsListQuery({ ...scope, page: 1, limit: 20 });
  await timeQuery('table (page 1, 20 rows)', { sql: list.sql, values: list.values });
  await timeQuery('table count', { sql: list.countSql, values: list.values.slice(0, -2) }); // the last two values are LIMIT and OFFSET
  const sum = q.buildCommercialDocumentsSummaryQuery(scope);
  await timeQuery('summary cards', sum);
  const plant = q.buildCommercialDocumentsCompletenessByPlantQuery(scope);
  await timeQuery('completeness by plant', plant);

  console.log('\n=== 2. the share (stat / list / read, only what exists)');
  const rows = await pool.query(`SELECT file_path, file_size FROM commercial_document_files ORDER BY created_at DESC LIMIT 15`);
  const statMs = [];
  for (const r of rows.rows) {
    const abs = resolveUploadAbsolutePath(r.file_path);
    const t = process.hrtime.bigint();
    fs.existsSync(abs);
    statMs.push(ms(t));
  }
  console.log(`  stat of the ${rows.rows.length} newest files        ${stat(statMs)}`);

  const miss = [];
  for (let i = 0; i < 5; i += 1) {
    const t = process.hrtime.bigint();
    fs.existsSync(path.join(path.dirname(resolveUploadAbsolutePath(rows.rows[0].file_path)), `__no_such_file_${i}.pdf`));
    miss.push(ms(t));
  }
  console.log(`  stat of a file that is not there   ${stat(miss)}`);

  if (rows.rows[0]) {
    const dir = path.dirname(resolveUploadAbsolutePath(rows.rows[0].file_path));
    const t = process.hrtime.bigint();
    let n = -1;
    try {
      n = fs.readdirSync(dir).length;
    } catch {
      /* unreadable */
    }
    console.log(`  list one PO folder (${n} entries)    ${ms(t)} ms`);
  }

  // a real PDF of 0.2 - 5 MB, read completely: what the preview of a fresh upload does
  const candidates = rows.rows.filter((r) => Number(r.file_size) > 200_000 && Number(r.file_size) < 5_000_000).slice(0, 3);
  for (const r of candidates) {
    const abs = resolveUploadAbsolutePath(r.file_path);
    const t = process.hrtime.bigint();
    let size = 0;
    try {
      size = fs.readFileSync(abs).length;
    } catch {
      /* gone */
    }
    const took = ms(t);
    console.log(`  read ${(size / 1e6).toFixed(2)} MB in ${took} ms  (${took > 0 ? (size / 1e6 / (took / 1000)).toFixed(1) : '?'} MB/s)`);
  }
  if (!candidates.length) console.log('  (no file of 0.2 - 5 MB among the newest 15; nothing to read)');

  console.log('\nHow to read it: seconds in section 1 = the refresh behind an upload is the slow part. Tens of ms per stat in section 2 = the share is slow, and every naming / read-back / preview step pays it.');
  await pool.end();
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
