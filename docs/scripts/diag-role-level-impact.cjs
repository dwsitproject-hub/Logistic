/*
 * READ-ONLY: what happens to ADMIN and MANAGEMENT users if those two roles stop carrying a Level.
 *
 *   cd /opt/klip && git fetch origin SIT --quiet && git show origin/SIT:docs/scripts/diag-role-level-impact.cjs | docker exec -i klip-backend node -
 *   (an optional argument lists other roles too:  ... | docker exec -i klip-backend node - ADMIN MANAGEMENT SUPPORT)
 *
 * Why it is needed: a permission row belongs to Role + Level + Transport, and the user's own level picks which row applies (utils/rolePermissionScope.ts, the
 * "most specific match wins" LATERAL). A user whose level is emptied only matches rows with level NULL. If the roles page has only ever saved level-specific rows for
 * Management, emptying the level silently removes every permission and the menu goes blank. This prints, per role:
 *
 *  1. Users by level / transport / status.
 *  2. Permission rows by level / transport (is there ANY level NULL row?).
 *  3. Whether the levels of one role grant the same thing (md5 of the grants): identical levels can be folded into one level-NULL set without loss.
 *  4. For every (role, level, transport) in use: the permissions the user has NOW versus after the level is emptied, with the keys that would be lost or gained.
 *  5. Users whose level changes behaviour elsewhere (the Missing ETA bell scopes only level = Staff).
 *
 * It only SELECTs. Nothing is written to the database or to a file.
 */
const path = require('path');
const fs = require('fs');
const DIST = ['/app/dist', path.join(__dirname, '..', '..', 'backend', 'dist')].find((p) => fs.existsSync(p));
if (!DIST) {
  console.error('no backend build found (looked in /app/dist and ../../backend/dist)');
  process.exit(1);
}
const { query } = require(path.join(DIST, 'database/connection'));

const ROLES = (process.argv.slice(2).length ? process.argv.slice(2) : ['ADMIN', 'MANAGEMENT']).map((r) => r.toUpperCase());

const norm = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const flagStr = (p) => `${p.can_view ? 'V' : '-'}${p.can_create ? 'C' : '-'}${p.can_edit ? 'E' : '-'}${p.can_delete ? 'D' : '-'}`;

/** The rows the app would pick for this scope: same rule as ROLE_PERMISSION_LATERAL_MATCH_SQL / _ORDER_SQL. level = null means "the user has no level". */
async function effective(roleName, level, transport) {
  const r = await query(
    `SELECT p.permission_key, scoped.can_view, scoped.can_create, scoped.can_edit, scoped.can_delete
       FROM roles r
       JOIN permissions p ON true
       JOIN LATERAL (
         SELECT rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
           FROM role_permissions rp
          WHERE rp.role_id = r.id AND rp.permission_id = p.id
            AND (rp.level IS NULL OR ($2::text IS NOT NULL AND UPPER(TRIM(rp.level)) = UPPER(TRIM($2::text))))
            AND (rp.transport_type IS NULL OR ($3::text IS NOT NULL AND UPPER(TRIM(rp.transport_type)) = UPPER(TRIM($3::text))))
          ORDER BY CASE WHEN rp.level IS NULL THEN 0 ELSE 1 END DESC, CASE WHEN rp.transport_type IS NULL THEN 0 ELSE 1 END DESC
          LIMIT 1
       ) scoped ON true
      WHERE r.role_name = $1 AND r.is_active = true`,
    [roleName, level, transport],
  );
  const m = new Map();
  for (const row of r.rows) m.set(row.permission_key, row);
  return m;
}

(async () => {
  for (const role of ROLES) {
    console.log(`\n================ ${role} ================`);

    const users = await query(
      `SELECT COALESCE(NULLIF(TRIM(level), ''), '(none)') AS level, COALESCE(NULLIF(TRIM(transport_type), ''), '(none)') AS transport,
              COALESCE(is_active, true) AS active, count(*)::int AS n
         FROM users WHERE role = $1 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
      [role],
    );
    console.log('\n1. users by level / transport / active');
    console.table(users.rows);

    const rows = await query(
      `SELECT COALESCE(rp.level, '(NULL)') AS level, COALESCE(rp.transport_type, '(NULL)') AS transport, count(*)::int AS permission_rows,
              count(*) FILTER (WHERE rp.can_view)::int AS can_view
         FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
        WHERE r.role_name = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
      [role],
    );
    console.log('2. permission rows by level / transport (a (NULL) level row is what a level-less user matches)');
    console.table(rows.rows);
    const hasNullLevel = rows.rows.some((x) => x.level === '(NULL)');
    console.log(hasNullLevel ? '   -> level NULL rows exist.' : '   -> NO level NULL rows: a user with an empty level would match nothing for this role.');

    const grants = await query(
      `SELECT COALESCE(rp.level, '(NULL)') AS level, COALESCE(rp.transport_type, '(NULL)') AS transport,
              md5(string_agg(p.permission_key || ':' || rp.can_view::int || rp.can_create::int || rp.can_edit::int || rp.can_delete::int, ',' ORDER BY p.permission_key)) AS grants_md5,
              count(*)::int AS n
         FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
        WHERE r.role_name = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
      [role],
    );
    console.log('3. do the levels grant the same thing? (equal md5 = identical set)');
    console.table(grants.rows);
    const distinct = new Set(grants.rows.map((g) => g.grants_md5));
    console.log(`   -> ${distinct.size} distinct permission set(s) across ${grants.rows.length} level/transport scope(s).`);

    const combos = await query(
      `SELECT NULLIF(TRIM(level), '') AS level, NULLIF(UPPER(TRIM(transport_type)), '') AS transport, count(*)::int AS n
         FROM users WHERE role = $1 AND COALESCE(is_active, true) GROUP BY 1, 2 ORDER BY 1, 2`,
      [role],
    );
    console.log('4. per scope in use: permissions NOW vs with the level emptied (view = can_view true)');
    for (const c of combos.rows) {
      const now = await effective(role, c.level, c.transport);
      const after = await effective(role, null, c.transport);
      const viewNow = new Set([...now].filter(([, v]) => v.can_view).map(([k]) => k));
      const viewAfter = new Set([...after].filter(([, v]) => v.can_view).map(([k]) => k));
      const lost = [...viewNow].filter((k) => !viewAfter.has(k)).sort();
      const gained = [...viewAfter].filter((k) => !viewNow.has(k)).sort();
      const changedFlags = [...now]
        .filter(([k, v]) => after.has(k) && flagStr(v) !== flagStr(after.get(k)))
        .map(([k, v]) => `${k} ${flagStr(v)} -> ${flagStr(after.get(k))}`)
        .sort();
      console.log(`\n   level=${c.level ?? '(none)'}  transport=${c.transport ?? '(none)'}  users=${c.n}`);
      console.log(`     view permissions now=${viewNow.size}  after=${viewAfter.size}  lost=${lost.length}  gained=${gained.length}  flags changed=${changedFlags.length}`);
      if (lost.length) console.log(`     LOST view:   ${lost.join(', ')}`);
      if (gained.length) console.log(`     GAINED view: ${gained.join(', ')}`);
      if (changedFlags.length) console.log(`     FLAGS:       ${changedFlags.slice(0, 40).join(' | ')}${changedFlags.length > 40 ? ' ...' : ''}`);
    }
  }

  const staff = await query(
    `SELECT role, count(*)::int AS users FROM users WHERE UPPER(TRIM(COALESCE(level, ''))) = 'STAFF' AND role = ANY($1::text[]) AND COALESCE(is_active, true) GROUP BY role`,
    [ROLES],
  );
  console.log('\n5. users of these roles whose level is Staff (the Missing ETA bell narrows by plant/product only for Staff; emptied = sees everything)');
  console.table(staff.rows);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', String(e && e.message ? e.message : e).slice(0, 400));
  process.exit(1);
});
