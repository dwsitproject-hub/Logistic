/**
 * Restore master_plants.group_plant after migration 195 (2026-09-30).
 *
 * Migration 195 reloaded master_plants from the CPO workbook and left group_plant NULL on every row.
 * groupPlantExpr (utils/groupPlantSql.ts) then returns 'Blank' for every contract, and Pre-Planned
 * excludes 'Blank' - so the auto-grouping pool was empty and the startup rebuild superseded every
 * SUGGESTED group.
 *
 * group_plant is a business grouping (Bulking Batam, EOP Tj Morawa, Trading ...), NOT the new
 * location column `site`: 'Trading' is what keeps trading plants out of Pre-Planned. So the value is
 * restored from the backup taken before the deploy, per plant_code, choosing the same backup row
 * groupPlantExpr's code-only branch chose (latest updated_at among rows with a plant_name).
 *
 * Dry run by default: everything happens in one transaction and is ROLLED BACK. It prints how many
 * contracts would resolve to a different Group Plant than before migration 195 (computed against the
 * backup with the real groupPlantExpr), and the new distribution. APPLY=1 commits, then rebuilds
 * Pre-Planned groups, then prints the plant_code -> group_plant list for the repo migration.
 *
 *   docker exec -i klip-backend node - < restore-group-plant-20260930.js            (dry run)
 *   docker exec -i -e APPLY=1 klip-backend node - < restore-group-plant-20260930.js (apply)
 */
const ROOT = process.env.KLIP_ROOT || '/app/dist';
const conn = require(`${ROOT}/database/connection`);
const pool = conn.default || conn;
const { groupPlantExpr } = require(`${ROOT}/utils/groupPlantSql`);

const APPLY = process.env.APPLY === '1';
const BAK = process.env.BAK_TABLE || 'master_plants_bak_20260930';

(async () => {
  const c = await pool.connect();
  let committed = false;
  try {
    const bak = await c.query('SELECT to_regclass($1) AS t', [BAK]);
    if (!bak.rows[0].t) throw new Error(`backup table ${BAK} does not exist - nothing to restore from`);

    await c.query('BEGIN');
    const exprNew = groupPlantExpr('c.plant_code', 'c.company_name');
    const exprOld = exprNew.split('FROM master_plants mp').join(`FROM ${BAK} mp`);
    if (exprOld === exprNew) throw new Error('could not point groupPlantExpr at the backup table');

    // Each contract's Group Plant as it resolved BEFORE migration 195.
    await c.query(`CREATE TEMP TABLE gp_before ON COMMIT DROP AS
      SELECT c.id, ${exprOld} AS old_gp FROM contracts c`);

    const upd = await c.query(`UPDATE master_plants m SET group_plant = (
        SELECT NULLIF(TRIM(b.group_plant), '')
        FROM ${BAK} b
        WHERE TRIM(UPPER(COALESCE(b.plant_code, ''))) = TRIM(UPPER(COALESCE(m.plant_code, '')))
          AND NULLIF(TRIM(b.plant_name), '') IS NOT NULL
        ORDER BY b.updated_at DESC NULLS LAST
        LIMIT 1
      )`);
    const setRows = (await c.query(
      `SELECT count(*)::int n FROM master_plants WHERE NULLIF(TRIM(group_plant), '') IS NOT NULL`,
    )).rows[0].n;
    console.log(`master_plants rows updated: ${upd.rowCount}, with a group_plant now: ${setRows}`);

    // Migration 190 (CNF -> CFR) superseded SUGGESTED groups without releasing their members. A
    // member left active in a SUPERSEDED group holds ux_ppgm_active_contract, and every later
    // rebuild that regroups that contract fails with a duplicate key - the nightly cron included.
    const rel = await c.query(`UPDATE pre_planned_group_members pgm
      SET released_at = now()
      FROM pre_planned_groups pg
      WHERE pgm.group_id = pg.id
        AND pg.status = 'SUPERSEDED'
        AND pgm.released_at IS NULL`);
    console.log(`members released from SUPERSEDED groups: ${rel.rowCount}`);

    await c.query(`CREATE TEMP TABLE gp_after ON COMMIT DROP AS
      SELECT c.id, ${exprNew} AS new_gp FROM contracts c`);

    const tot = (await c.query(`SELECT
        count(*)::int AS contracts,
        count(*) FILTER (WHERE b.old_gp IS DISTINCT FROM a.new_gp)::int AS differ,
        count(*) FILTER (WHERE b.old_gp NOT IN ('Blank', 'Trading'))::int AS eligible_before,
        count(*) FILTER (WHERE a.new_gp NOT IN ('Blank', 'Trading'))::int AS eligible_after
      FROM gp_before b JOIN gp_after a USING (id)`)).rows[0];
    console.log(`contracts: ${tot.contracts}  differ from before-195: ${tot.differ}`);
    console.log(`not Blank/Trading (Pre-Planned candidates by plant): before ${tot.eligible_before}  after ${tot.eligible_after}`);

    const diff = (await c.query(`SELECT b.old_gp, a.new_gp, count(*)::int n
      FROM gp_before b JOIN gp_after a USING (id)
      WHERE b.old_gp IS DISTINCT FROM a.new_gp
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25`)).rows;
    if (diff.length) {
      console.log('\ndiffering (before -> after):');
      diff.forEach((r) => console.log(`  ${String(r.old_gp).padEnd(24)} -> ${String(r.new_gp).padEnd(24)} ${r.n}`));
    }

    const dist = (await c.query(`SELECT new_gp, count(*)::int n FROM gp_after GROUP BY 1 ORDER BY 2 DESC LIMIT 30`)).rows;
    console.log('\nGroup Plant after restore:');
    dist.forEach((r) => console.log(`  ${String(r.new_gp).padEnd(24)} ${r.n}`));

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\nDRY RUN - rolled back, nothing saved. Re-run with APPLY=1 to save.');
      return;
    }
    await c.query('COMMIT');
    committed = true;
    console.log('\nCOMMITTED.');

    const map = (await c.query(`SELECT DISTINCT UPPER(TRIM(plant_code)) AS code, group_plant AS gp
      FROM master_plants WHERE NULLIF(TRIM(group_plant), '') IS NOT NULL ORDER BY 1`)).rows;
    console.log(`MAPPING ${JSON.stringify(map.map((r) => [r.code, r.gp]))}`);
  } catch (e) {
    if (!committed) await c.query('ROLLBACK').catch(() => {});
    console.error('ERROR:', e.message);
    process.exitCode = 1;
    return;
  } finally {
    c.release();
  }

  if (APPLY && process.env.SKIP_REBUILD !== '1') {
    const { rebuildPrePlannedGroups } = require(`${ROOT}/services/prePlannedGroup.service`);
    const r = await rebuildPrePlannedGroups('manual-restore-group-plant-20260930');
    console.log('\nPre-Planned rebuild:', JSON.stringify(r));
  }
})()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(() => pool.end().then(() => process.exit()));
