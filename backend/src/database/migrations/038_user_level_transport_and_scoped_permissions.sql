-- Add user level/transport/plant attributes and scoped role permissions

-- 1) User profile dimensions
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS level VARCHAR(30),
  ADD COLUMN IF NOT EXISTS transport_type VARCHAR(10),
  ADD COLUMN IF NOT EXISTS plant VARCHAR(150);

-- Normalize any existing invalid values before adding checks
UPDATE users
SET level = NULL
WHERE level IS NOT NULL
  AND UPPER(TRIM(level)) NOT IN ('DEPT HEAD', 'SECTION HEAD', 'STAFF', 'ADMIN');

UPDATE users
SET transport_type = NULL
WHERE transport_type IS NOT NULL
  AND UPPER(TRIM(transport_type)) NOT IN ('SEA', 'LAND');

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_level_check;
ALTER TABLE users
  ADD CONSTRAINT users_level_check
  CHECK (level IS NULL OR UPPER(TRIM(level)) IN ('DEPT HEAD', 'SECTION HEAD', 'STAFF', 'ADMIN'));

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_transport_type_check;
ALTER TABLE users
  ADD CONSTRAINT users_transport_type_check
  CHECK (transport_type IS NULL OR UPPER(TRIM(transport_type)) IN ('SEA', 'LAND'));

CREATE INDEX IF NOT EXISTS idx_users_level ON users(level);
CREATE INDEX IF NOT EXISTS idx_users_transport_type ON users(transport_type);
CREATE INDEX IF NOT EXISTS idx_users_plant ON users(plant);

-- 2) Scoped role permissions (role + level + transport_type)
ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS level VARCHAR(30),
  ADD COLUMN IF NOT EXISTS transport_type VARCHAR(10);

UPDATE role_permissions
SET level = NULL
WHERE level IS NOT NULL
  AND UPPER(TRIM(level)) NOT IN ('DEPT HEAD', 'SECTION HEAD', 'STAFF', 'ADMIN');

UPDATE role_permissions
SET transport_type = NULL
WHERE transport_type IS NOT NULL
  AND UPPER(TRIM(transport_type)) NOT IN ('SEA', 'LAND');

ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_level_check;
ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_level_check
  CHECK (level IS NULL OR UPPER(TRIM(level)) IN ('DEPT HEAD', 'SECTION HEAD', 'STAFF', 'ADMIN'));

ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_transport_type_check;
ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_transport_type_check
  CHECK (transport_type IS NULL OR UPPER(TRIM(transport_type)) IN ('SEA', 'LAND'));

DROP INDEX IF EXISTS uq_role_permissions_scope;
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permissions_scope
  ON role_permissions (
    role_id,
    permission_id,
    COALESCE(UPPER(TRIM(level)), ''),
    COALESCE(UPPER(TRIM(transport_type)), '')
  );

CREATE INDEX IF NOT EXISTS idx_role_permissions_scope_lookup
  ON role_permissions (
    role_id,
    COALESCE(UPPER(TRIM(level)), ''),
    COALESCE(UPPER(TRIM(transport_type)), '')
  );

