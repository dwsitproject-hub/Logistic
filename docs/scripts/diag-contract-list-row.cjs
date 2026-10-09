/**
 * READ-ONLY. What does the Contracts / Contract Performance LIST ENDPOINT itself return for one contract?
 *
 * diag-cp-null-status.cjs recomputes the status expressions in isolation. If they say a status exists while the page shows a dash, the
 * difference is somewhere between the list query and the screen. This calls the route handler itself (getContracts, with a mock req/res, the
 * same way diag-four-page-os.cjs calls getShipments) and prints the row it would send, so the answer is the endpoint's, not a copy's.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-contract-list-row.cjs \
 *     | docker exec -i klip-backend node - --contract=1621000086
 *
 * Matches by contract number or PO through the list's own `search`. Nothing is written.
 */
const path = require('path');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

(async () => {
  const contract = arg('contract');
  if (!contract) {
    console.error('Give --contract=<contract number or PO>.');
    process.exit(1);
  }
  const pool = dist('database/connection').default;
  try {
    const { getContracts } = dist('controllers/contract.controller');
    const res = {
      statusCode: 200,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.payload = body;
        return this;
      },
      setHeader() {
        return this;
      },
      set() {
        return this;
      },
    };
    const req = {
      query: { page: '1', limit: '10', search: contract },
      params: {},
      body: {},
      headers: {},
      user: { id: '00000000-0000-0000-0000-000000000000', role: 'ADMIN', permissions: ['*'] },
    };
    await getContracts(req, res);
    const rows = res.payload?.data?.contracts ?? [];
    console.log(`HTTP ${res.statusCode}  success=${res.payload?.success}  rows=${rows.length}`);
    if (res.statusCode !== 200) console.log(JSON.stringify(res.payload).slice(0, 400));
    for (const r of rows) {
      console.log(
        `  contract=${r.contract_id}  po=${r.po_number}  incoterm=${r.incoterm}  mode=${r.transport_mode}` +
          `\n     shipment_status=${JSON.stringify(r.shipment_status)}  trucking_status=${JSON.stringify(r.trucking_status)}` +
          `\n     has the keys: shipment_status=${'shipment_status' in r}  trucking_status=${'trucking_status' in r}`,
      );
    }
    if (rows.length === 0) console.log('The list returned no row for that search - try the other number (contract vs PO).');
  } catch (error) {
    console.error('Failed:', error && error.message ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
