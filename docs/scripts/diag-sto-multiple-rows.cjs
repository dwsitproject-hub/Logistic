/*
 * READ-ONLY: why does an STO have more than one shipment row, and is it normal?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-sto-multiple-rows.cjs | docker exec -i klip-backend node - --sto=1006020654
 *   (production: the same with origin/main; without --sto only the summary is printed)
 *
 * KLIP keeps ONE shipments row PER PO: a voyage with three POs is three rows that share the STO and the operation, and the Shipments table shows them as one. That is normal.
 * What is NOT normal is the SAME PO (contract) on more than one live row of one STO key: a KLIP plan next to the row SAP inserted (the MT. ARCADIA pattern), or a re-plan after a
 * row was completed. This counts both, lists the suspects, and with --sto=<number> prints every row of that STO with its PO, status, operation, source and documents.
 * An STO "key" is the one the Shipments page and JPS use (shipmentListStoKeyExpr): the numeric shipment id, else the contract's STO, else the SAP effective STO, else the operation id.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const line = (s = '') => console.log(s);
const head = (s) => {
  line();
  line(`== ${s}`);
};
const show = (v) => (v == null ? '-' : v instanceof Date ? v.toISOString().slice(0, 16) : String(v).slice(0, 28));

(async () => {
  const pool = dist('database/connection').default;
  try {
    const { STO_KEY_SQL } = dist('jps/eligibility');
    const q = (sql, params) => pool.query(sql, params);
    const FROM = `
      FROM shipments s
      INNER JOIN contracts c ON c.id = s.contract_id
      LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id`;

    head('1. STO keys with more than one live (not cancelled) shipment row');
    const groups = (
      await q(
        `WITH r AS (
           SELECT ${STO_KEY_SQL} AS sto_key, s.id, s.contract_id, s.status, s.operation_id ${FROM}
            WHERE COALESCE(s.status, '') NOT IN ('CANCELLED', 'CANCELED')
         )
         SELECT sto_key, COUNT(*)::int AS rows, COUNT(DISTINCT contract_id)::int AS pos,
                COUNT(DISTINCT operation_id) FILTER (WHERE operation_id IS NOT NULL)::int AS operations,
                BOOL_OR(status = 'COMPLETED') AS any_completed
           FROM r GROUP BY sto_key HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC, sto_key`,
      )
    ).rows;
    const normal = groups.filter((g) => g.rows === g.pos);
    const suspect = groups.filter((g) => g.rows > g.pos);
    line(`  STO keys with several rows           : ${groups.length}`);
    line(`  - one row per PO (normal)            : ${normal.length}`);
    line(`  - the SAME PO on more than one row   : ${suspect.length}   <- the suspects`);
    const mixedCompleted = suspect.filter((g) => g.any_completed).length;
    line(`    of which with a COMPLETED row      : ${mixedCompleted}   (a re-plan, or SAP row + plan)`);
    for (const g of suspect.slice(0, 12)) {
      line(`    STO ${String(g.sto_key).padEnd(14)} ${g.rows} rows on ${g.pos} PO(s), ${g.operations} operation(s)${g.any_completed ? ', one COMPLETED' : ''}`);
    }

    const stoArg = process.argv.find((a) => a.startsWith('--sto='));
    const targets = stoArg ? [stoArg.slice('--sto='.length).trim()] : suspect.slice(0, 3).map((g) => g.sto_key);
    for (const sto of targets) {
      head(`2. Every shipment row of STO ${sto}`);
      const rows = (
        await q(
          `SELECT s.id::text AS id, s.shipment_id, s.operation_id, s.status, s.vessel_name, s.voyage_no, s.created_at, s.updated_at,
                  c.contract_id AS contract_number, c.po_number, c.sto_number AS contract_sto, l.effective_sto,
                  (SELECT COUNT(*)::int FROM documents d WHERE d.shipment_id = s.id AND d.deleted_at IS NULL) AS docs,
                  (SELECT COUNT(*)::int FROM vessel_loading_ports v WHERE v.shipment_id = s.id) AS port_rows
             ${FROM}
            WHERE ${STO_KEY_SQL} = $1
            ORDER BY s.created_at`,
          [sto],
        )
      ).rows;
      if (rows.length === 0) line('  no row has this STO key');
      for (const r of rows) {
        const origin = /^(MNL|MSEA)-/i.test(String(r.shipment_id || '')) ? 'KLIP plan' : /^[0-9]+$/.test(String(r.shipment_id || '')) ? 'SAP row' : 'other';
        line(`  ${show(r.created_at)}  ${origin.padEnd(9)} shipment_id ${show(r.shipment_id).padEnd(22)} status ${String(r.status || '-').padEnd(11)} PO ${show(r.po_number).padEnd(12)} contract ${show(r.contract_number)}`);
        line(`      operation ${show(r.operation_id)}  vessel ${show(r.vessel_name)} voyage ${show(r.voyage_no)}  documents ${r.docs}  port rows ${r.port_rows}  (contract STO ${show(r.contract_sto)}, SAP effective STO ${show(r.effective_sto)})`);
      }
      const byContract = new Map();
      for (const r of rows) byContract.set(r.contract_number, (byContract.get(r.contract_number) || 0) + 1);
      const dup = [...byContract.entries()].filter(([, n]) => n > 1);
      line(dup.length ? `  -> the same contract on several rows: ${dup.map(([c, n]) => `${c} x${n}`).join(', ')}` : '  -> every row is a different contract (one row per PO)');
    }
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
