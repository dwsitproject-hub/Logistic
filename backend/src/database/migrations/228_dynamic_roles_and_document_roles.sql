-- Roles can be created in the app, and seven roles that open only Commercial Documents.
--
-- 1) users.role was limited by a hard-coded CHECK list (migration 176), so a role created on the Roles page could never be
--    assigned to a user. The roles table is the list now: a foreign key on role_name replaces the CHECK.
--    NOT VALID so an existing row that points at a missing role cannot fail the migration (and stop the backend from booting);
--    it is validated right after, and a failure there is only a NOTICE.
-- 2) roles.uses_region_scope: whether the Users page offers a Region/Plant default filter for the role. Until now that was
--    hard-coded to LOGISTICS and TRADING in the controller and in the page.
-- 3) Seven document roles (one per sheet of "Email User Klip.xlsx"): the only page permission is Commercial Documents,
--    view + create + edit, no delete - the same grant migration 080 gave the business roles.
--
-- Additive and idempotent. The users themselves are loaded by docs/scripts/load-document-role-users.cjs, not here, so that
-- SIT and dev do not receive production accounts.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_fkey') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_fkey
      FOREIGN KEY (role) REFERENCES roles(role_name) ON UPDATE CASCADE
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE users VALIDATE CONSTRAINT users_role_fkey;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'users_role_fkey left NOT VALID (%): some user has a role missing from roles', SQLERRM;
END $$;

ALTER TABLE roles ADD COLUMN IF NOT EXISTS uses_region_scope BOOLEAN NOT NULL DEFAULT false;

UPDATE roles SET uses_region_scope = true WHERE role_name IN ('LOGISTICS', 'TRADING');

INSERT INTO roles (role_name, display_name, description, uses_region_scope) VALUES
  ('BC',              'BC',              'Commercial Documents only (site-scoped by Region/Plant)', true),
  ('AR_UPSTREAM',     'AR UPSTREAM',     'Commercial Documents only', false),
  ('AR_DOWNSTREAM',   'AR DOWNSTREAM',   'Commercial Documents only', false),
  ('TAX_UPSTREAM',    'TAX UPSTREAM',    'Commercial Documents only', false),
  ('AP_DOWNSTREAM',   'AP DOWNSTREAM',   'Commercial Documents only', false),
  ('TAX_DOWNSTREAM',  'TAX DOWNSTREAM',  'Commercial Documents only', false),
  ('CLAIM',           'CLAIM',           'Commercial Documents only', false)
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, false
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('BC', 'AR_UPSTREAM', 'AR_DOWNSTREAM', 'TAX_UPSTREAM', 'AP_DOWNSTREAM', 'TAX_DOWNSTREAM', 'CLAIM')
  AND p.permission_key = 'page.commercial_documents'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NULL
      AND rp.transport_type IS NULL
  );
