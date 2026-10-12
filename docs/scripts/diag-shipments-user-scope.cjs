/*
 * READ-ONLY: why does a contract / PO show on the Shipments page for Admin but not for a Staff user?
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-shipments-user-scope.cjs \
 *     | docker exec -i klip-backend node - --user=<username or email> --po=1011003250 [--from=2026-01-01 --to=2026-10-12]
 *
 * The list endpoint does not look at who is asking. What differs between two people is the DEFAULT SCOPE the page puts on a Staff user - the Region/Plant and the
 * Products assigned on the Users page - sent as `plant=` and a `product` column filter. So this calls the real route handler (getShipments, mock req/res, the way
 * diag-four-page-os.cjs does) with the same parameters the page builds, five ways:
 *
 *   A  the user's own scope (Region/Plant AND Product), searching the PO   <- what that user sees
 *   B  no scope at all, searching the PO                                   <- what Admin sees
 *   C  only the user's Region/Plant
 *   D  only the user's Product
 *   E  the user's own scope, no search                                     <- how many rows the user gets
 *
 * and prints whether the PO is in each, with the contract's own product and Region/Site next to the user's. Nothing is written.
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

    const run = async (label, { plants, products, search }) => {
      const params = { page: '1', limit: '200', compact: 'true' };
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
      const hit = rows.filter((r) => JSON.stringify(r).includes(po));
      console.log(`  ${label.padEnd(44)} HTTP ${code}  rows=${String(total).padStart(5)}  PO present: ${hit.length > 0 ? 'YES' : 'no'}`);
      return hit.length > 0;
    };

    console.log('\nscenarios (search = the PO unless noted):');
    const A = await run('A  user scope (Region/Plant + Product)', { plants: scope.group_plants, products: scope.products, search: true });
    const B = await run('B  no scope (what Admin sees)', { search: true });
    const C = await run('C  only the Region/Plant', { plants: scope.group_plants, search: true });
    const D = await run('D  only the Product', { products: scope.products, search: true });
    await run('E  user scope, no search', { plants: scope.group_plants, products: scope.products, search: false });

    console.log('\nreading:');
    if (A) console.log('  The user\'s own scope DOES list the PO through the endpoint - the cause is on the page side (filters changed on screen, a stale tab, the status or date filter).');
    else if (B && !C && D) console.log('  Hidden by the Region/Plant assignment: the contract\'s Region/Site is not in the user\'s list above.');
    else if (B && C && !D) console.log('  Hidden by the Product assignment: the contract\'s product is not in the user\'s list above.');
    else if (B && !C && !D) console.log('  Hidden by BOTH assignments.');
    else if (B && C && D) console.log('  Each filter alone keeps the PO but the two together drop it - a bug in how the filters combine; send this output.');
    else console.log('  Not even the unscoped search finds it with these date parameters - widen --from/--to.');
  } catch (error) {
    console.error('Failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
