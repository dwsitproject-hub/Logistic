/*
 * Fill documents.uploaded_by for the files uploaded before the upload handler started writing it (2026-11-27).
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/backfill-document-uploaded-by.cjs | docker exec -i klip-backend node -
 *   add --apply to write (without it nothing is written).
 *
 * The column has existed since migration 001 and was never filled. Who uploaded a file is in audit_logs: the auditLog('CREATE', 'DOCUMENT') middleware on POST /documents/upload
 * writes one entry whose entity_id is the document's id. This copies that user into the column, for the rows that are still empty.
 *
 * Safe by construction: it only touches rows where uploaded_by IS NULL, never overwrites a value, and takes the audit entry closest to the document's upload_date inside the
 * same window the COD Shipment Docs card uses (2 minutes before to 10 minutes after; audit_logs has no index on entity_id, the time window is what bounds the lookup).
 * A document with no matching entry stays NULL (older than the audit trail, or uploaded by a script) and is counted in the output.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const APPLY = process.argv.includes('--apply');

const CANDIDATES_SQL = `
  SELECT d.id, d.document_type, d.upload_date, au.user_id, u.username
    FROM documents d
    LEFT JOIN LATERAL (
      SELECT al.user_id
        FROM audit_logs al
       WHERE al.entity_id = d.id
         AND al.entity_type = 'DOCUMENT'
         AND al.action = 'CREATE'
         AND al.user_id IS NOT NULL
         AND al."timestamp" >= d.upload_date - INTERVAL '2 minutes'
         AND al."timestamp" <= d.upload_date + INTERVAL '10 minutes'
       ORDER BY ABS(EXTRACT(EPOCH FROM (al."timestamp" - d.upload_date)))
       LIMIT 1
    ) au ON TRUE
    LEFT JOIN users u ON u.id = au.user_id
   WHERE d.uploaded_by IS NULL
`;

(async () => {
  const pool = dist('database/connection').default;
  try {
    const total = (await pool.query(`SELECT COUNT(*)::int AS n, COUNT(uploaded_by)::int AS filled FROM documents`)).rows[0];
    const rows = (await pool.query(CANDIDATES_SQL)).rows;
    const matched = rows.filter((r) => r.user_id && r.username);
    const unmatched = rows.filter((r) => !r.user_id || !r.username);

    console.log(`documents: ${total.n} (uploaded_by already filled: ${total.filled}, empty: ${rows.length})`);
    console.log(`  can be filled from the audit trail : ${matched.length}`);
    console.log(`  no audit entry found (stay empty)  : ${unmatched.length}`);

    const tally = (list, key) => {
      const m = new Map();
      for (const r of list) m.set(r[key] || '(none)', (m.get(r[key] || '(none)') || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    console.log('\nby document type (fillable / empty after):');
    const types = new Set(rows.map((r) => String(r.document_type || '')));
    for (const t of [...types].sort()) {
      const f = matched.filter((r) => String(r.document_type || '') === t).length;
      const e = unmatched.filter((r) => String(r.document_type || '') === t).length;
      console.log(`  ${t.padEnd(14)} ${String(f).padStart(5)} / ${String(e).padStart(5)}`);
    }
    console.log('\nwho the fillable files belong to:');
    for (const [name, n] of tally(matched, 'username').slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${name}`);

    if (!APPLY) {
      console.log('\nDRY RUN: nothing written. Add --apply to fill the column.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let written = 0;
      for (const r of matched) {
        // The WHERE repeats the guard: a value written since the SELECT is never overwritten.
        const res = await client.query(`UPDATE documents SET uploaded_by = $2::uuid WHERE id = $1::uuid AND uploaded_by IS NULL`, [r.id, r.user_id]);
        written += res.rowCount;
      }
      await client.query('COMMIT');
      console.log(`\nAPPLIED: uploaded_by filled on ${written} documents.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
