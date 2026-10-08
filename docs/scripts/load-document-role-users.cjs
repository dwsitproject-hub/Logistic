/**
 * Create the accounts listed in "Email User Klip.xlsx" (docs/): 50 people, one role per sheet, level Staff, and the Region/Plant
 * of each BC user. Dry run unless --apply. Needs no deploy of its own, but migration 228 must be live first (it creates the roles).
 *
 *   cd /opt/klip && git fetch origin main --quiet && git show origin/main:docs/scripts/load-document-role-users.cjs \
 *     | docker exec -i klip-backend node -
 *   ... | docker exec -i klip-backend node - --apply
 *
 * What it does and does not do
 *  - Never touches an account that already exists (matched on email, case-insensitive); it only reports it.
 *  - Never prints or stores a known password. Each new account gets a random one nobody knows, and is flagged to change it at
 *    first login. People sign in through Hub SSO (KLIP matches the SSO email to an active account), or an admin sets a password
 *    with Reset Password on the Users page.
 *  - Region/Plant is the DEFAULT FILTER on the pages the user opens, as everywhere in KLIP - the user can clear it. It is not an
 *    access limit. It is only stored for roles marked "uses Region/Plant" (BC).
 *  - Every Region/Plant is checked against the list the Users page offers (live SAP discharge destinations). An apply stops if
 *    one is not on that list, unless --allow-unknown-regions.
 *  - All inserts happen in one transaction: all accounts, or none.
 */
const path = require('path');
const crypto = require('crypto');
const dist = (p) => require(path.join(process.cwd(), 'dist', p));

const USERS = [
  {
    "role": "BC",
    "email": "reavend.jaki@energi-up.com",
    "fullName": "Reavend Jaki",
    "region": "KARAWANG"
  },
  {
    "role": "BC",
    "email": "yuyung.narudin@energi-up.com",
    "fullName": "Yuyung Narudin",
    "region": "KARAWANG"
  },
  {
    "role": "BC",
    "email": "gita.alfiani@energi-up.com",
    "fullName": "Gita Alfiani",
    "region": "KARAWANG"
  },
  {
    "role": "BC",
    "email": "erismaida.nainggolan@energi-up.com",
    "fullName": "Erismaida Nainggolan",
    "region": "KARAWANG"
  },
  {
    "role": "BC",
    "email": "betha.destanti@energi-up.com",
    "fullName": "Betha Destanti",
    "region": "BEKASI"
  },
  {
    "role": "BC",
    "email": "falitha.delicawati@energi-up.com",
    "fullName": "Falitha Delicawati",
    "region": "BEKASI"
  },
  {
    "role": "BC",
    "email": "iftahul.huda@energi-up.com",
    "fullName": "Iftahul Huda",
    "region": "BEKASI"
  },
  {
    "role": "BC",
    "email": "nela.tambunan@energi-up.com",
    "fullName": "Nela Tambunan",
    "region": "TANJUNG MORAWA"
  },
  {
    "role": "BC",
    "email": "naufal.nasution@energi-up.com",
    "fullName": "Naufal Nasution",
    "region": "TANJUNG MORAWA"
  },
  {
    "role": "BC",
    "email": "febrianto.rahmawan@energi-up.com",
    "fullName": "Febrianto Rahmawan",
    "region": "TANJUNG MORAWA"
  },
  {
    "role": "BC",
    "email": "yosua.sirait@energi-up.com",
    "fullName": "Yosua Sirait",
    "region": "TANJUNG MORAWA"
  },
  {
    "role": "BC",
    "email": "rico.romandani@cisadane.co.id",
    "fullName": "Rico Romandani",
    "region": "TANGERANG"
  },
  {
    "role": "BC",
    "email": "andrie@cisadane.co.id",
    "fullName": "Andrie",
    "region": "TANGERANG"
  },
  {
    "role": "BC",
    "email": "rinaldi.capry@cisadane.co.id",
    "fullName": "Rinaldi Capry",
    "region": "TANGERANG"
  },
  {
    "role": "BC",
    "email": "arye.fauzi@energi-up.com",
    "fullName": "Arye Fauzi",
    "region": "BONTANG"
  },
  {
    "role": "BC",
    "email": "saiful.saiful@energi-up.com",
    "fullName": "Saiful Saiful",
    "region": "BONTANG"
  },
  {
    "role": "BC",
    "email": "basrudin.basrudin@energi-up.com",
    "fullName": "Basrudin Basrudin",
    "region": "BONTANG"
  },
  {
    "role": "BC",
    "email": "andi.marsuma@energi-up.com",
    "fullName": "Andi Marsuma",
    "region": "BONTANG"
  },
  {
    "role": "BC",
    "email": "fitri.rahmadhani@energi-up.com",
    "fullName": "Fitri Rahmadhani",
    "region": "BONTANG"
  },
  {
    "role": "BC",
    "email": "zarial.fahni@energi-up.com",
    "fullName": "Zarial Fahni",
    "region": "LUBUK GAUNG"
  },
  {
    "role": "BC",
    "email": "ahmad.zahrinsyah@energi-up.com",
    "fullName": "Ahmad Zahrinsyah",
    "region": "LUBUK GAUNG"
  },
  {
    "role": "BC",
    "email": "akbar.kaloko@energi-up.com",
    "fullName": "Akbar Kaloko",
    "region": "LUBUK GAUNG"
  },
  {
    "role": "BC",
    "email": "sabhariya.sabhariya@energi-up.com",
    "fullName": "Sabhariya Sabhariya",
    "region": "TANJUNG PURA"
  },
  {
    "role": "BC",
    "email": "wani.anjeli@energi-up.com",
    "fullName": "Wani Anjeli",
    "region": "TANJUNG PURA"
  },
  {
    "role": "BC",
    "email": "irgi.ferdinan@energi-up.com",
    "fullName": "Irgi Ferdinan",
    "region": "TANJUNG PURA"
  },
  {
    "role": "BC",
    "email": "dadang.kurniawan@energi-up.com",
    "fullName": "Dadang Kurniawan",
    "region": "TANJUNG PURA"
  },
  {
    "role": "AR_UPSTREAM",
    "email": "handri.setiadi@kpnplantation.com",
    "fullName": "Handri Setiadi",
    "region": null
  },
  {
    "role": "AR_UPSTREAM",
    "email": "novianti.susanto@kpnplantation.com",
    "fullName": "Novianti Susanto",
    "region": null
  },
  {
    "role": "AR_UPSTREAM",
    "email": "indriyani.pertiwi@kpnplantation.com",
    "fullName": "Indriyani Pertiwi",
    "region": null
  },
  {
    "role": "AR_UPSTREAM",
    "email": "aurellia.clarissa@kpnplantation.com",
    "fullName": "Aurellia Clarissa",
    "region": null
  },
  {
    "role": "AR_UPSTREAM",
    "email": "cahya.indrianti@kpnplantation.com",
    "fullName": "Cahya Indrianti",
    "region": null
  },
  {
    "role": "AR_DOWNSTREAM",
    "email": "eva.shinta@energi-up.com",
    "fullName": "Eva Shinta",
    "region": null
  },
  {
    "role": "AR_DOWNSTREAM",
    "email": "liliosa.yusti@energi-up.com",
    "fullName": "Liliosa Yusti",
    "region": null
  },
  {
    "role": "AR_DOWNSTREAM",
    "email": "arsi.damayanti@energi-up.com",
    "fullName": "Arsi Damayanti",
    "region": null
  },
  {
    "role": "AR_DOWNSTREAM",
    "email": "audithya.prawita@energi-up.com",
    "fullName": "Audithya Prawita",
    "region": null
  },
  {
    "role": "AR_DOWNSTREAM",
    "email": "nicolaus.adriyanto@energi-up.com",
    "fullName": "Nicolaus Adriyanto",
    "region": null
  },
  {
    "role": "TAX_UPSTREAM",
    "email": "ose.olivia@kpnplantation.com",
    "fullName": "Ose Olivia",
    "region": null
  },
  {
    "role": "TAX_UPSTREAM",
    "email": "daffa.harun@kpnplantation.com",
    "fullName": "Daffa Harun",
    "region": null
  },
  {
    "role": "AP_DOWNSTREAM",
    "email": "yoshua.siregar@energi-up.com",
    "fullName": "Yoshua Siregar",
    "region": null
  },
  {
    "role": "AP_DOWNSTREAM",
    "email": "lita.untari@energi-up.com",
    "fullName": "Lita Untari",
    "region": null
  },
  {
    "role": "TAX_DOWNSTREAM",
    "email": "irawaty.tjie@energi-up.com",
    "fullName": "Irawaty Tjie",
    "region": null
  },
  {
    "role": "TAX_DOWNSTREAM",
    "email": "hendri.wijaya@energi-up.com",
    "fullName": "Hendri Wijaya",
    "region": null
  },
  {
    "role": "TAX_DOWNSTREAM",
    "email": "robin.william@energi-up.com",
    "fullName": "Robin William",
    "region": null
  },
  {
    "role": "TAX_DOWNSTREAM",
    "email": "michelle.tanley@energi-up.com",
    "fullName": "Michelle Tanley",
    "region": null
  },
  {
    "role": "TAX_DOWNSTREAM",
    "email": "marco.kenji@energi-up.com",
    "fullName": "Marco Kenji",
    "region": null
  },
  {
    "role": "TAX_DOWNSTREAM",
    "email": "rachell.andika@energi-up.com",
    "fullName": "Rachell Andika",
    "region": null
  },
  {
    "role": "CLAIM",
    "email": "fally.ribka@energi-up.com",
    "fullName": "Fally Ribka",
    "region": null
  },
  {
    "role": "CLAIM",
    "email": "nurul.fitriani@energi-up.com",
    "fullName": "Nurul Fitriani",
    "region": null
  },
  {
    "role": "CLAIM",
    "email": "yustinus.refiano@energi-up.com",
    "fullName": "Yustinus Refiano",
    "region": null
  },
  {
    "role": "CLAIM",
    "email": "galih.asysyifa@energi-up.com",
    "fullName": "Galih Asysyifa",
    "region": null
  }
];

(async () => {
  const apply = process.argv.includes('--apply');
  const allowUnknownRegions = process.argv.includes('--allow-unknown-regions');
  const pool = dist('database/connection').default;
  const bcrypt = require('bcryptjs');
  const { REGION_SITE_FILTER_OPTIONS_SQL, filterRegionSiteOptionValues } = dist('utils/regionSiteSql');
  const { canonicalizeUserRegionSites } = dist('utils/userRegionSite');

  // 1. the roles must exist (migration 228)
  const roleNames = [...new Set(USERS.map((u) => u.role))];
  const rolesRes = await pool.query(
    `SELECT role_name, is_active, uses_region_scope FROM roles WHERE role_name = ANY($1::text[])`,
    [roleNames],
  );
  const roles = new Map(rolesRes.rows.map((r) => [r.role_name, r]));
  const missingRoles = roleNames.filter((r) => !roles.has(r) || roles.get(r).is_active === false);
  if (missingRoles.length > 0) {
    console.error(`Roles missing or inactive: ${missingRoles.join(', ')}. Deploy the backend (migration 228) first.`);
    await pool.end();
    process.exit(1);
  }

  // 2. the Region/Plant values must be ones the Users page offers
  const optionRows = await pool.query(REGION_SITE_FILTER_OPTIONS_SQL);
  const offered = filterRegionSiteOptionValues(optionRows.rows.map((r) => String(r.group_plant)));
  const offeredByUpper = new Map(offered.map((o) => [o.toUpperCase(), o]));
  const wantedRegions = [...new Set(USERS.map((u) => u.region).filter(Boolean))];
  const unknownRegions = [];
  const regionResolved = new Map();
  for (const wanted of wantedRegions) {
    const canonical = canonicalizeUserRegionSites([wanted])[0];
    const hit = offeredByUpper.get(String(canonical).toUpperCase());
    if (hit) regionResolved.set(wanted, hit);
    else unknownRegions.push(wanted);
  }
  console.log('Region/Plant check against the Users page list:');
  for (const w of wantedRegions) console.log(`  ${w.padEnd(16)} ${regionResolved.has(w) ? `ok (${regionResolved.get(w)})` : 'NOT ON THE LIST'}`);
  if (unknownRegions.length > 0) {
    console.log(`\n  The list the page offers has ${offered.length} value(s): ${offered.join(', ')}`);
  }

  // 3. who already exists
  const emails = USERS.map((u) => u.email);
  const existing = await pool.query(
    `SELECT LOWER(email) AS email, role, is_active FROM users WHERE LOWER(email) = ANY($1::text[]) OR LOWER(username) = ANY($1::text[])`,
    [emails],
  );
  const existingByEmail = new Map(existing.rows.map((r) => [r.email, r]));

  const toCreate = [];
  console.log(`\n${apply ? 'APPLY' : 'DRY RUN'} - ${USERS.length} account(s) in the file`);
  for (const u of USERS) {
    const ex = existingByEmail.get(u.email);
    if (ex) {
      console.log(`  exists   ${u.email}  (role ${ex.role}${ex.is_active ? '' : ', inactive'}) - left as it is${ex.role !== u.role ? `   !! file says ${u.role}` : ''}`);
      continue;
    }
    toCreate.push(u);
    const scoped = roles.get(u.role).uses_region_scope && u.region;
    console.log(`  create   ${u.email.padEnd(40)} ${u.fullName.padEnd(24)} ${u.role.padEnd(15)} Staff${scoped ? `   Region/Plant ${regionResolved.get(u.region) || u.region}` : ''}`);
  }
  console.log(`\n${toCreate.length} to create, ${USERS.length - toCreate.length} already exist.`);

  if (!apply) {
    console.log('\nDry run - nothing written. Add --apply to create them.');
    await pool.end();
    return;
  }
  if (unknownRegions.length > 0 && !allowUnknownRegions) {
    console.error('\nStopped: a Region/Plant is not on the Users page list. Fix the name, or run again with --allow-unknown-regions.');
    await pool.end();
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let created = 0;
    for (const u of toCreate) {
      // nobody knows this password: sign-in is by Hub SSO, or after an admin Reset Password
      const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
      const regionName = regionResolved.get(u.region) || u.region || null;
      const useRegion = Boolean(roles.get(u.role).uses_region_scope && regionName);
      const regions = useRegion ? canonicalizeUserRegionSites([regionName]) : [];
      const ins = await client.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, level, plant, is_first_login, is_active)
         VALUES ($1, $1, $2, $3, $4, 'Staff', $5, true, true)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [u.email, passwordHash, u.fullName, u.role, regions.length ? regions.join(', ').slice(0, 150) : null],
      );
      if (ins.rows.length === 0) {
        console.log(`  skipped  ${u.email} (created by someone else while this ran)`);
        continue;
      }
      if (regions.length > 0) {
        await client.query(
          `INSERT INTO user_region_sites (user_id, region_site) SELECT $1, unnest($2::text[]) ON CONFLICT (user_id, region_site) DO NOTHING`,
          [ins.rows[0].id, regions],
        );
      }
      created += 1;
    }
    await client.query('COMMIT');
    console.log(`\nCreated ${created} account(s).`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\nRolled back, nothing created: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
