-- Administrator and Management are not ranked: they carry NO level, and their permissions are one set (level NULL).
--
-- Before this, a permission row belonged to Role + Level + Transport and a user's level picked the row. For these two roles that left two layers: broad level-NULL rows
-- and narrower level-specific rows, and which one a user got depended on a level nobody needed to have. Measured on production 2026-11-17 (diag-role-level-impact.cjs):
--   ADMIN       the 3 users with level Admin lacked 17 view permissions (Dashboard, Finance, Documents, Customer 360, ...) that the other Administrator had.
--   MANAGEMENT  the level-NULL set is much broader than what the 6 users really get (45 view permissions against 21-23): Users, SAP, Audit, Finance, Claim Mutu/Susut
--               and Create/Edit on Commercial Documents. Simply emptying the level would have opened all of that.
--
-- So MANAGEMENT's one set becomes what its Dept Head users effectively have today (the Dept Head row where there is one, else the level-NULL row: the same rule the
-- permission lookup applies), which leaves the 5 Dept Head users exactly as they are. ADMIN keeps its full level-NULL set. Then every level-specific row of both roles is
-- removed and their users' level is emptied. Anything wider for Management is granted per permission in Manage Roles from now on.
--
-- Both tables are copied first (role_permissions_bak_20261117, users_level_bak_20261117). To undo: copy those rows back and re-save the levels.
-- A database that has no Management permissions at all (a fresh one) is left alone.

CREATE TABLE IF NOT EXISTS role_permissions_bak_20261117 AS
SELECT rp.*
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
WHERE r.role_name IN ('ADMIN', 'MANAGEMENT');

CREATE TABLE IF NOT EXISTS users_level_bak_20261117 AS
SELECT id, role, level, transport_type
FROM users
WHERE role IN ('ADMIN', 'MANAGEMENT') AND level IS NOT NULL;

-- ADMIN: a permission that only the level-specific rows grant must not be lost when they go (none expected: the level-NULL set holds every permission).
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT ON (rp.permission_id) rp.role_id, rp.permission_id, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
WHERE r.role_name = 'ADMIN'
  AND rp.level IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions nl
    WHERE nl.role_id = rp.role_id AND nl.permission_id = rp.permission_id AND nl.level IS NULL AND nl.transport_type IS NULL
  )
ORDER BY rp.permission_id, rp.can_view DESC;

DELETE FROM role_permissions rp
USING roles r
WHERE r.id = rp.role_id AND r.role_name = 'ADMIN' AND rp.level IS NOT NULL;

-- MANAGEMENT: the effective Dept Head set becomes the level-NULL set.
CREATE TEMP TABLE _mgmt_one_set AS
SELECT r.id AS role_id, p.id AS permission_id,
       COALESCE(dh.can_view, nl.can_view) AS can_view,
       COALESCE(dh.can_create, nl.can_create) AS can_create,
       COALESCE(dh.can_edit, nl.can_edit) AS can_edit,
       COALESCE(dh.can_delete, nl.can_delete) AS can_delete
FROM roles r
CROSS JOIN permissions p
LEFT JOIN role_permissions dh
  ON dh.role_id = r.id AND dh.permission_id = p.id AND dh.transport_type IS NULL AND UPPER(TRIM(dh.level)) = 'DEPT HEAD'
LEFT JOIN role_permissions nl
  ON nl.role_id = r.id AND nl.permission_id = p.id AND nl.transport_type IS NULL AND nl.level IS NULL
WHERE r.role_name = 'MANAGEMENT'
  AND (dh.id IS NOT NULL OR nl.id IS NOT NULL);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _mgmt_one_set) THEN
    DELETE FROM role_permissions rp USING roles r WHERE r.id = rp.role_id AND r.role_name = 'MANAGEMENT';
    INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
    SELECT role_id, permission_id, COALESCE(can_view, false), COALESCE(can_create, false), COALESCE(can_edit, false), COALESCE(can_delete, false)
    FROM _mgmt_one_set;
  END IF;
END $$;

DROP TABLE _mgmt_one_set;

UPDATE users SET level = NULL, updated_at = CURRENT_TIMESTAMP
WHERE role IN ('ADMIN', 'MANAGEMENT') AND level IS NOT NULL;

-- What it did, readable in the deploy log.
DO $$
DECLARE
  adm int; mgmt int; mgmt_view int; users_cleared int;
BEGIN
  SELECT count(*) INTO adm FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.role_name = 'ADMIN';
  SELECT count(*), count(*) FILTER (WHERE rp.can_view) INTO mgmt, mgmt_view FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.role_name = 'MANAGEMENT';
  SELECT count(*) INTO users_cleared FROM users_level_bak_20261117;
  RAISE NOTICE 'ADMIN permission rows=%, MANAGEMENT permission rows=% (view=%), users whose level was cleared=%', adm, mgmt, mgmt_view, users_cleared;
END $$;
