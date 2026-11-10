/*
 * Release the Preplanned members that a CANCELLED shipment's group still holds.
 *
 *   docker exec -i klip-backend node - [--apply] < release-preplanned-cancelled-holders.cjs
 *   (or: cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/release-preplanned-cancelled-holders.cjs | docker exec -i klip-backend node - --apply)
 *
 * Dry run unless --apply. Needs no deploy: it uses only the database connection of the running container, and no code from the image.
 *
 * Why: a Preplanned group linked to a shipment keeps its members active (released_at NULL). When that shipment was CANCELLED nothing released them, so the PO came
 * back as Unplanned and could be selected, but the old active row still held it and ux_ppgm_active_contract refused a new Preplanned group
 * ("duplicate key value violates unique constraint"; PO 1001032955, group PPM-BONTAN-016, production 2026-11-09). The same stale rows also keep the PO out of the
 * nightly auto-grouping. The code fix (grouping and the nightly rebuild release such holders themselves, and cancelling a shipment releases them) makes this
 * script unnecessary once it is deployed; run it only to free the POs that are blocked today.
 *
 * What it changes: pre_planned_group_members.released_at = now() for the active members of an ACCEPTED group whose linked shipment is CANCELLED. Nothing else:
 * the group keeps its status, shipment link and history (the member row stays, released). A group linked to a Planned or Completed shipment, and an unlinked
 * Preplanned group, are never touched.
 */
const { Pool } = require('pg');

(async () => {
  const apply = process.argv.includes('--apply');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const WHERE = `
    pgm.released_at IS NULL
    AND pg.status = 'ACCEPTED'
    AND pg.shipment_id IS NOT NULL
    AND UPPER(TRIM(COALESCE(s.status, ''))) IN ('CANCELLED', 'CANCELED')`;

  const rows = await pool.query(
    `SELECT pgm.id::text AS member_id, c.contract_id, c.po_number, pg.group_code, pg.source, s.status AS shipment_status, pgm.created_at::date AS member_since
       FROM pre_planned_group_members pgm
       JOIN pre_planned_groups pg ON pg.id = pgm.group_id
       JOIN shipments s ON s.id = pg.shipment_id
       JOIN contracts c ON c.id = pgm.contract_id
      WHERE ${WHERE}
      ORDER BY pgm.created_at`,
  );
  console.log(`${rows.rows.length} active member(s) held by a group whose shipment is cancelled:`);
  console.table(rows.rows.map(({ member_id, ...rest }) => rest));

  if (!apply) {
    console.log('Dry run. Run again with --apply to release them.');
    await pool.end();
    return;
  }
  if (rows.rows.length === 0) {
    console.log('Nothing to release.');
    await pool.end();
    return;
  }

  const ids = rows.rows.map((r) => r.member_id);
  const res = await pool.query(
    `UPDATE pre_planned_group_members pgm
        SET released_at = now()
       FROM pre_planned_groups pg
       JOIN shipments s ON s.id = pg.shipment_id
      WHERE pgm.group_id = pg.id AND pgm.id = ANY($1::uuid[]) AND ${WHERE}`,
    [ids],
  );
  console.log(`Released ${res.rowCount} member(s).`);
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
