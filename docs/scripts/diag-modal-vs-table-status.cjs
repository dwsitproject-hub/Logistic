/*
 * Compare the status the Shipments TABLE shows for a shipment with the status Edit Shipment shows when that row is opened, for every multi-PO shipment.
 *
 *   docker exec -i klip-backend node - [--all] [--limit=N] [--show=N] < docs/scripts/diag-modal-vs-table-status.cjs
 *   (or: cd /opt/klip && git show origin/SIT:docs/scripts/diag-modal-vs-table-status.cjs | docker exec -i klip-backend node - --show=80)
 *
 * READ-ONLY. It writes nothing and needs no deploy: it calls code already in the running image.
 *   table  = the stage the Shipments page derives for the group (the same derivation the KMAPS partner records and the pipeline summary use:
 *            buildPartnerGroupsSql, i.e. shipmentPageEffectiveStatusExpr over the pipeline base with the own-STO columns);
 *   modal  = `effectiveStatus` of resolveShipmentEditPayload(<the row the Shipments LIST opens for the group>), the value the modal shows as Shipment Status.
 *            That row is chosen with the list's own ranking (sqlShipmentListPrimaryOrderBy, which counts a manual ATA override as "has an ATA"). The pipeline derivation
 *            ranks without the override, so its primary_id can be another row of the group, one a user can never open from the list; opening that one gave a false
 *            difference on SIT (operation OP-1004030473-15277540).
 *
 * Why: the modal used to read the one row it opened, so a finished PO made it say Completed while the table, for an operation with POs added after the voyage, said
 * Unloading (SIT operation OP-1004030473-15277540). The modal now applies the table's rule to an operation-keyed group (applyOperationCompletionRule). This script
 * shows what still differs.
 *
 * Flags:
 *   --all        also compare single-PO groups (default: only groups of two or more POs, where the two readings can differ)
 *   --limit=N    stop after N groups (default: all of them)
 *   --show=N     print at most N differing groups per kind (default 40)
 *
 * Cost: the table side is one full Shipments-scope derivation (seconds on SIT, do not run it casually against production at 06:00-10:00 WIB), then one modal payload
 * per group. Progress is printed every 25 groups.
 *
 * Reading the result: "operation-keyed" groups should have NO row where the modal is Completed and the table is not. The remaining differences are expected in two places:
 *   - the table is Completed and the modal is not: the table also completes a group when every contract's OS is inside the tolerance band even with no ATC, and the modal
 *     does not read that;
 *   - STO-keyed groups (the key is an STO number): the modal keeps the opened row's own reading there.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const normalize = (value) => {
  const s = String(value ?? '').trim().toUpperCase();
  if (s === 'UNPLANNED') return 'PLANNED';
  if (s === 'CANCELED') return 'CANCELLED';
  return s;
};
const intFlag = (name, fallback) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = arg ? Number(arg.slice(name.length + 3)) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
};

(async () => {
  const pool = dist('database/connection').default;
  const { buildPartnerGroupsSql } = dist('partner/recordSql');
  const { resolveShipmentEditPayload } = dist('services/shipmentEditPayload.service');
  const { sqlShipmentListPrimaryOrderBy } = dist('utils/shipmentListPrimaryShipmentSql');
  const listPrimaryOrderBy = sqlShipmentListPrimaryOrderBy('$2::text', 'c', 'l', 's', undefined, 'sao');
  let primaryDiffers = 0;

  const all = process.argv.includes('--all');
  const limit = intFlag('limit', Infinity);
  const show = intFlag('show', 40);

  console.log('Reading the table side (one full derivation)...');
  const startedAt = Date.now();
  const groups = (await pool.query(buildPartnerGroupsSql())).rows;
  console.log(`  ${groups.length} shipments (groups) in the Shipments scope, ${Math.round((Date.now() - startedAt) / 1000)}s`);

  const targets = groups.filter((g) => all || (Array.isArray(g.member_ids) && g.member_ids.length >= 2)).slice(0, limit);
  console.log(`Comparing ${targets.length} ${all ? '' : 'multi-PO '}group(s) with the modal...`);

  const results = [];
  let done = 0;
  const queue = [...targets];
  const worker = async () => {
    while (queue.length > 0) {
      const g = queue.shift();
      if (!g) break;
      let modal = null;
      let error = null;
      let openedId = String(g.primary_id);
      try {
        const members = Array.isArray(g.member_ids) ? g.member_ids : [];
        if (members.length > 1) {
          const ranked = await pool.query(
            `SELECT s.id::text AS id FROM shipments s LEFT JOIN contracts c ON c.id = s.contract_id LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
              WHERE s.id = ANY($1::uuid[]) ORDER BY ${listPrimaryOrderBy} LIMIT 1`,
            [members, String(g.sto_key)],
          );
          if (ranked.rows[0]?.id) openedId = ranked.rows[0].id;
        }
        if (openedId !== String(g.primary_id)) primaryDiffers += 1;
        const payload = await resolveShipmentEditPayload(openedId);
        modal = payload ? normalize(payload.effectiveStatus) : null;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const key = String(g.sto_key);
      results.push({
        key,
        keyed: /^\d+$/.test(key) ? 'STO' : 'operation',
        pos: Array.isArray(g.member_ids) ? g.member_ids.length : 1,
        table: normalize(g.stage),
        modal,
        error,
        primary: openedId.slice(0, 8),
      });
      done += 1;
      if (done % 25 === 0) console.log(`  ${done}/${targets.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  const kind = (r) => {
    if (r.error || r.modal === null) return 'modal could not be read';
    if (r.modal === r.table) return 'same';
    if (r.modal === 'COMPLETED') return 'modal Completed, table not';
    if (r.table === 'COMPLETED') return 'table Completed, modal not';
    return 'other difference';
  };

  for (const keyed of ['operation', 'STO']) {
    const rows = results.filter((r) => r.keyed === keyed);
    if (rows.length === 0) continue;
    const counts = {};
    for (const r of rows) counts[kind(r)] = (counts[kind(r)] || 0) + 1;
    console.log(`\n== ${keyed}-keyed groups: ${rows.length}`);
    console.table(Object.entries(counts).map(([what, n]) => ({ what, groups: n })));
    for (const what of Object.keys(counts).filter((w) => w !== 'same')) {
      const diff = rows.filter((r) => kind(r) === what);
      console.log(`-- ${what} (${diff.length}${diff.length > show ? `, first ${show}` : ''})`);
      console.table(
        diff.slice(0, show).map((r) => ({ key: r.key, pos: r.pos, table: r.table, modal: r.modal ?? '-', primary: r.primary, error: r.error ? r.error.slice(0, 60) : '' })),
      );
    }
  }

  console.log(`\n${primaryDiffers} group(s): the row the list opens is not the pipeline derivation's primary row (compared with the list's row).`);
  const operationGroups = results.filter((r) => r.keyed === 'operation').length;
  const bad = results.filter((r) => r.keyed === 'operation' && kind(r) === 'modal Completed, table not').length;
  if (operationGroups === 0) {
    console.log('\nNo operation-keyed group was compared (a --limit sample may have held none): nothing is proven about operations. Run without --limit.');
  } else if (bad === 0) {
    console.log(`\nOK: ${operationGroups} operation-keyed group(s) compared, none where the modal says Completed and the table does not.`);
  } else {
    console.log(`\nATTENTION: ${bad} of ${operationGroups} operation-keyed group(s) where the modal says Completed and the table does not.`);
  }
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
