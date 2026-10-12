/*
 * READ-ONLY: why does a contract / PO show on the Shipments page for Admin but not for a Staff user?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-shipments-user-scope.cjs \
 *     | docker exec -i klip-backend node - --user=<username or email> --po=1011003250 [--from=2026-01-01 --to=2026-12-31]
 *
 * The list endpoint does not look at who is asking. What differs between two people is the DEFAULT SCOPE the page puts on a Staff user - the Region/Plant and the
 * Products assigned on the Users page - sent as `plant=` and a `product` column filter. So this calls the real route handler (getShipments, mock req/res, the way
 * diag-four-page-os.cjs does) with the parameters the page builds. The page sends skipSapJoin=true (the fast list path), so every search scenario is run with
 * skipSapJoin false AND true:
 *
 *   A  the user's own scope (Region/Plant AND Product), searching the PO   <- what that user sees
 *   B  no scope at all, searching the PO                                   <- what Admin sees
 *   C  only the user's Region/Plant
 *   D  only the user's Product
 *
 * Then WITHOUT a search, 20 rows a page like the table, it reads page after page and says on which page the PO sits for the user's scope (E) and for no scope (F).
 * Nothing is written. The handler also starts its usual background vessel backfill, which can log warnings after the answer; they are not part of this check.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const userArg = arg('user');
const po = arg('po');
const from = arg('from');
const to = arg('to');
if (!userArg || !po) {
  console.error('Give --user=<username or email> and --po=<PO or contract number>.');
  process.exit(1);
}

(async () => {
  const pool = dist('database/connection').default;
  const { fetchUserScopeAssociations } = dist('services/userAssociations.service');
  const { getShipments } = dist('controllers/shipment.controller');
  try {
    const u = (
      await pool.query(
        `SELECT id, username, email, role, level, transport_type FROM users
         WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 2`,
        [userArg],
      )
    ).rows;
    if (u.length === 0) {
      console.log('No user with that username or email.');
      return;
    }
    const user = u[0];
    const scope = await fetchUserScopeAssociations(user.id);
    console.log(`user      : ${user.username} <${user.email}>  role=${user.role}  level=${user.level}  transport=${user.transport_type || '-'}`);
    console.log(`Region/Plant assigned : ${JSON.stringify(scope.group_plants)}`);
    console.log(`Products assigned     : ${JSON.stringify(scope.products)}`);

    const c = (
      await pool.query(
        `SELECT c.contract_id, c.po_number, c.product, c.incoterm, c.transport_mode, c.status, c.source_type,
                l.discharge_destination, (SELECT COUNT(*) FROM shipments s WHERE s.contract_id = c.id) AS shipments
         FROM contracts c
         LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
         WHERE c.contract_id = $1 OR TRIM(c.po_number::text) = $1 LIMIT 3`,
        [po],
      )
    ).rows;
    console.log('\ncontract(s) for that PO / number:');
    c.forEach((r) =>
      console.log(`  ${r.contract_id}  po=${r.po_number}  product=${JSON.stringify(r.product)}  incoterm=${r.incoterm}  region(SAP discharge)=${JSON.stringify(r.discharge_destination)}  status=${r.status}  shipments=${r.shipments}`),
    );

    const run = async (label, opts) => {
      const { plants, products, search, skipSapJoin = false, page = 1, limit = 200, quiet = false } = opts;
      const params = {
        page: String(page),
        limit: String(limit),
        compact: 'true',
        includeSummary: 'false',
        skipSapJoin: skipSapJoin ? 'true' : 'false',
      };
      if (from) params.dateFrom = from;
      if (to) params.dateTo = to;
      if (search) params.search = po;
      if (plants && plants.length) params.plant = plants;
      if (products && products.length) {
        params.columnFilters = JSON.stringify({ product: { type: 'multi', values: products, includeBlank: false } });
      }
      let payload = null;
      let code = 200;
      const res = {
        status(s) { code = s; return this; },
        json(p) { payload = p; return this; },
        setHeader() { return this; },
        send(p) { payload = p; return this; },
      };
      await getShipments({ query: params, params: {}, body: {}, headers: {}, user: { id: user.id, role: user.role } }, res);
      const rows = (payload && payload.data && payload.data.shipments) || [];
      const total = payload && payload.data && payload.data.pagination ? payload.data.pagination.total : rows.length;
      const found = rows.some((r) => JSON.stringify(r).includes(po));
      if (!quiet) console.log(`  ${label.padEnd(52)} HTTP ${code}  rows=${String(total).padStart(5)}  PO present: ${found ? 'YES' : 'no'}`);
      return { found, total, count: rows.length };
    };

    console.log('\nsearch scenarios (search = the PO). The page sends skipSapJoin=true, so each runs both ways:');
    const scoped = { plants: scope.group_plants, products: scope.products };
    const f = {};
    for (const skip of [false, true]) {
      const tag = skip ? ' [skipSapJoin=true, as the page]' : ' [skipSapJoin=false]';
      f['A' + skip] = (await run('A  user scope' + tag, { ...scoped, search: true, skipSapJoin: skip })).found;
      f['B' + skip] = (await run('B  no scope (Admin)' + tag, { search: true, skipSapJoin: skip })).found;
      f['C' + skip] = (await run('C  only Region/Plant' + tag, { plants: scope.group_plants, search: true, skipSapJoin: skip })).found;
      f['D' + skip] = (await run('D  only Product' + tag, { products: scope.products, search: true, skipSapJoin: skip })).found;
    }

    const locate = async (label, opts) => {
      for (let p = 1; p <= 80; p += 1) {
        const r = await run(label, { ...opts, search: false, skipSapJoin: true, page: p, limit: 20, quiet: true });
        if (r.found) {
          console.log(`  ${label.padEnd(30)} PO is on page ${p} of ${Math.ceil(r.total / 20)} (${r.total} rows)`);
          return p;
        }
        if (r.count < 20) {
          console.log(`  ${label.padEnd(30)} PO is NOT in any of the ${r.total} rows (${p} pages read)`);
          return null;
        }
      }
      console.log(`  ${label.padEnd(30)} PO not found in the first 80 pages`);
      return null;
    };
    console.log('\nwithout a search, 20 rows a page, skipSapJoin=true (what scrolling the table shows):');
    const posUser = await locate('E  user scope', scoped);
    const posAll = await locate('F  no scope (Admin)', {});

    console.log('\nreading:');
    if (f.Atrue && f.Btrue) console.log("  With the page's own parameters the PO is returned for the user and for Admin when searched; E/F say where it sits without a search.");
    else if (!f.Atrue && f.Btrue && f.Ctrue && !f.Dtrue) console.log("  Hidden by the Product assignment (the user's products are listed at the top).");
    else if (!f.Atrue && f.Btrue && !f.Ctrue && f.Dtrue) console.log('  Hidden by the Region/Plant assignment.');
    else if (!f.Atrue && f.Btrue && !f.Ctrue && !f.Dtrue) console.log('  Hidden by BOTH assignments.');
    else if (!f.Atrue && f.Btrue && f.Ctrue && f.Dtrue) console.log('  Each filter alone keeps the PO but the two together drop it - a bug in how the filters combine; send this output.');
    else if (!f.Atrue && !f.Btrue) console.log('  Not even the unscoped search finds it with these parameters - widen --from/--to.');
    if (f.Afalse !== f.Atrue || f.Bfalse !== f.Btrue) console.log('  NOTE: the answer DIFFERS between skipSapJoin=false and true - the fast list path treats this row differently.');
    if (posUser && posAll && posUser !== posAll) console.log(`  Without a search the PO sits on page ${posUser} for the user and page ${posAll} for Admin: the scope moves where it is, it does not remove it.`);
    if (!posUser && posAll) console.log("  Without a search the PO is in Admin's rows but NOT in the user's: the user's scope removes it from the table.");
  } catch (error) {
    console.error('Failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  } finally {
    // let the handler's fire-and-forget vessel backfill drain before the pool closes, or it logs a stream of closed-pool errors
    await new Promise((r) => setTimeout(r, 4000));
    await pool.end();
  }
})();
