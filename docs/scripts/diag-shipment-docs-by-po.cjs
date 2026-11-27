/**
 * READ-ONLY: how well can the Contract/SI/BL documents uploaded in KLIP (Shipments > Edit Shipment) be reached from a PO, the key Commercial Documents (COD) uses?
 * Changes nothing.
 *
 *   docker cp docs/scripts/diag-shipment-docs-by-po.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/diag-shipment-docs-by-po.cjs
 *
 * A document hangs on ONE shipment row (documents.shipment_id). A PO reaches shipment rows three ways:
 *   direct   shipments.contract_id = the PO's contract row
 *   by_sto   a shipment whose numeric shipment_id equals one of the PO's STOs (contract_stos)
 *   by_op    a shipment sharing operation_id with one of the PO's own shipments (an OP- operation with several POs)
 * The script counts how many documents and POs each way reaches, so the design can say which links are needed, and lists the ambiguous cases.
 */
const path = require('path');
const pool = require(path.join(process.cwd(), 'dist', 'database', 'connection')).default;

const DOC = `d.deleted_at IS NULL AND d.document_type IN ('SI','BL') AND d.shipment_id IS NOT NULL`;
const LINKS = `
  links AS (
    SELECT s.contract_id AS contract_uuid, s.id AS shipment_uuid, 'direct' AS via
    FROM shipments s WHERE s.contract_id IS NOT NULL
    UNION
    SELECT cs.contract_id, s.id, 'by_sto'
    FROM shipments s
    JOIN contract_stos cs ON TRIM(cs.sto_number::text) = TRIM(s.shipment_id::text)
    WHERE TRIM(COALESCE(s.shipment_id::text, '')) ~ '^[0-9]+$'
    UNION
    SELECT s1.contract_id, s2.id, 'by_op'
    FROM shipments s1
    JOIN shipments s2 ON NULLIF(TRIM(s2.operation_id::text), '') = NULLIF(TRIM(s1.operation_id::text), '')
    WHERE s1.contract_id IS NOT NULL AND NULLIF(TRIM(s1.operation_id::text), '') IS NOT NULL
  )`;

(async () => {
  const one = async (sql, params = []) => (await pool.query(sql, params)).rows;

  const [tot] = await one(`SELECT COUNT(*)::int AS docs, COUNT(DISTINCT d.shipment_id)::int AS shipments,
      COUNT(*) FILTER (WHERE d.document_type = 'SI')::int AS si, COUNT(*) FILTER (WHERE d.document_type = 'BL')::int AS bl
    FROM documents d WHERE ${DOC}`);
  console.log(`\n=== documents (SI/BL, not deleted): ${tot.docs} on ${tot.shipments} shipment rows  (SI ${tot.si}, BL ${tot.bl})`);

  const [noContract] = await one(`SELECT COUNT(*)::int AS n FROM documents d JOIN shipments s ON s.id = d.shipment_id WHERE ${DOC} AND s.contract_id IS NULL`);
  const [cancelled] = await one(`SELECT COUNT(*)::int AS n FROM documents d JOIN shipments s ON s.id = d.shipment_id WHERE ${DOC} AND s.status = 'CANCELLED'`);
  console.log(`    on a shipment row with no contract_id: ${noContract.n}   on a CANCELLED shipment: ${cancelled.n}`);

  console.log('\n=== which links reach the documents (a document can be reached by several links)');
  for (const via of ['direct', 'by_sto', 'by_op']) {
    const [r] = await one(
      `WITH ${LINKS}
       SELECT COUNT(DISTINCT d.id)::int AS docs, COUNT(DISTINCT l.contract_uuid)::int AS pos
       FROM links l JOIN documents d ON d.shipment_id = l.shipment_uuid
       WHERE ${DOC} AND l.via = $1`,
      [via],
    );
    console.log(`  ${via.padEnd(7)} reaches ${r.docs} documents from ${r.pos} PO(s)`);
  }
  const [any] = await one(`WITH ${LINKS} SELECT COUNT(DISTINCT d.id)::int AS docs, COUNT(DISTINCT l.contract_uuid)::int AS pos FROM links l JOIN documents d ON d.shipment_id = l.shipment_uuid WHERE ${DOC}`);
  const [onlyExtra] = await one(
    `WITH ${LINKS}, direct_docs AS (SELECT DISTINCT d.id FROM links l JOIN documents d ON d.shipment_id = l.shipment_uuid WHERE ${DOC} AND l.via = 'direct')
     SELECT COUNT(DISTINCT d.id)::int AS docs FROM links l JOIN documents d ON d.shipment_id = l.shipment_uuid
     WHERE ${DOC} AND l.via <> 'direct' AND d.id NOT IN (SELECT id FROM direct_docs)`,
  );
  console.log(`  any     reaches ${any.docs} of ${tot.docs} documents from ${any.pos} PO(s); ${onlyExtra.docs} are reachable ONLY through by_sto / by_op (a direct-only rule would miss them)`);

  console.log('\n=== documents per PO (all links)');
  const dist = await one(
    `WITH ${LINKS}, per_po AS (
       SELECT l.contract_uuid, COUNT(DISTINCT d.id) AS docs, COUNT(DISTINCT d.shipment_id) AS shipments
       FROM links l JOIN documents d ON d.shipment_id = l.shipment_uuid WHERE ${DOC} GROUP BY l.contract_uuid)
     SELECT COUNT(*)::int AS pos, MAX(docs)::int AS max_docs, ROUND(AVG(docs), 1)::float AS avg_docs,
            COUNT(*) FILTER (WHERE shipments > 1)::int AS pos_with_several_shipments, MAX(shipments)::int AS max_shipments
     FROM per_po`,
  );
  console.log(`  ${dist[0].pos} PO(s) have documents; max ${dist[0].max_docs} per PO, average ${dist[0].avg_docs}; ${dist[0].pos_with_several_shipments} PO(s) have documents from more than one shipment (max ${dist[0].max_shipments})`);

  const [shared] = await one(
    `WITH ${LINKS}, per_doc AS (
       SELECT d.id, COUNT(DISTINCT l.contract_uuid) AS pos
       FROM links l JOIN documents d ON d.shipment_id = l.shipment_uuid WHERE ${DOC} GROUP BY d.id)
     SELECT COUNT(*) FILTER (WHERE pos > 1)::int AS shared_docs, MAX(pos)::int AS max_pos FROM per_doc`,
  );
  console.log(`  ${shared.shared_docs} document(s) would show under more than one PO (max ${shared.max_pos} POs for one document): a BL of a multi-PO voyage`);

  console.log('\n=== sample (5 POs with the most documents)');
  const sample = await one(
    `WITH ${LINKS}
     SELECT c.po_number, COUNT(DISTINCT d.id)::int AS docs, COUNT(DISTINCT d.shipment_id)::int AS shipments
     FROM links l JOIN documents d ON d.shipment_id = l.shipment_uuid JOIN contracts c ON c.id = l.contract_uuid
     WHERE ${DOC} GROUP BY c.po_number ORDER BY docs DESC LIMIT 5`,
  );
  for (const r of sample) console.log(`  PO ${r.po_number}: ${r.docs} documents from ${r.shipments} shipment(s)`);

  await pool.end();
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
