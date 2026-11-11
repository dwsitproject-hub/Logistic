/*
 * Dry run of the per-STO SFAL / SFBD fill (backend/src/utils/sapFigureFill.ts). WRITES NOTHING: every statement runs inside one transaction that is rolled back.
 *
 *   cat docs/scripts/dryrun-sap-figure-fill.cjs | docker exec -i klip-backend node -
 *
 * It needs the build that contains sapFigureFill (dist/utils/sapFigureFill.js) and migration 263 (the sap_sfal_sto_qty / sap_sfbd_sto_qty columns).
 * Prints, per column: how many STOs carry a SAP figure and how the fill decides each (single / sum of shares / one = the repeated figure taken once / undecided), how many
 * of them a user owns, what each statement WOULD write, and a few undecided multi-PO STOs so someone can look at them. Running it twice gives the same answer.
 */
const pool = require('./dist/database/connection').default;
const { buildSapFigureFillStatements, buildSapFigureDecisionPreviewSql } = require('./dist/utils/sapFigureFill');

const COLUMNS = [
  { col: 'sfal_qty', sap: 'sap_sfal_qty', sto: 'sap_sfal_sto_qty' },
  { col: 'sfbd_qty', sap: 'sap_sfbd_qty', sto: 'sap_sfbd_sto_qty' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 120000');
    const live = `UPPER(COALESCE(status, '')) NOT IN ('CANCELLED', 'CANCELED')`;
    for (const { col, sto } of COLUMNS) {
      const before = (await client.query(`SELECT COUNT(*) FILTER (WHERE ${col} IS NOT NULL)::int AS working, COUNT(*) FILTER (WHERE ${sto} IS NOT NULL)::int AS sto_reference FROM shipments`)).rows[0];
      const preview = (await client.query(buildSapFigureDecisionPreviewSql(col))).rows;
      const how = {};
      for (const r of preview) how[r.how] = (how[r.how] || 0) + 1;
      console.log(`\n===== ${col} =====`);
      console.log('now:', JSON.stringify(before));
      console.log('STOs with a SAP figure:', preview.length, JSON.stringify(how));
      console.log('  decided but owned by a user (the working figure is not written):', preview.filter((r) => r.total !== null && r.any_owned).length);
      const undecided = preview.filter((r) => r.how === 'undecided' && r.n_rows > 1);
      console.log('  undecided multi-row STOs:', undecided.length);
      for (const r of undecided.slice(0, 6)) {
        console.log('   e.g.', JSON.stringify({ sto: r.sto, rows: r.n_rows, withFigure: r.n_sap, sumFigure: r.sum_sap, totalBL: r.sum_bl }));
      }

      const statements = buildSapFigureFillStatements(col);
      const wrote = {};
      for (const key of ['clearReference', 'setReference', 'setWorking', 'clearSiblings']) {
        wrote[key] = (await client.query(statements[key])).rowCount;
      }
      console.log('would write (rows):', JSON.stringify(wrote));

      const after = (await client.query(`SELECT COUNT(*) FILTER (WHERE ${col} IS NOT NULL)::int AS working, COUNT(*) FILTER (WHERE ${sto} IS NOT NULL)::int AS sto_reference FROM shipments`)).rows[0];
      console.log('after (inside the transaction):', JSON.stringify(after));
      // an STO no user owns must carry the working figure on ONE live row only (the list takes the MAX, Oil Loss reads the opened row)
      const twice = (await client.query(`
        SELECT COUNT(*)::int AS n FROM (
          SELECT TRIM(shipment_id::text) AS sto FROM shipments
           WHERE ${live} AND ${col} IS NOT NULL AND NULLIF(TRIM(shipment_id::text), '') IS NOT NULL
           GROUP BY TRIM(shipment_id::text)
          HAVING COUNT(*) > 1 AND NOT BOOL_OR('${col}' = ANY(COALESCE(klip_edited_fields, '{}')))
        ) x`)).rows[0].n;
      console.log('STOs where several live rows carry the working figure and no user owns it (should be 0 for decided STOs):', twice);
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  console.log('\nROLLED BACK: nothing was changed.');
  process.exit(0);
})().catch((e) => {
  console.error('DRY RUN FAILED:', e.message);
  process.exit(1);
});
