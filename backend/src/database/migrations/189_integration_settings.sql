-- Integration settings (DHM, JPS, ...) editable by ADMIN from the Integrations menu.
--
-- Until now every integration was configured in .env and needed SSH to change. Rotating a key
-- meant a hidden-prompt shell command, a container recreate, and knowing that
-- docker-compose.backend.yml's `environment:` block OVERRIDES backend/.env - get that wrong and the
-- key silently becomes an empty string. This table lets an ADMIN do it from the app instead.
--
-- .env stays the fallback. A setting with no row here keeps reading process.env exactly as before,
-- so deploying this changes nothing until someone saves a value.
--
-- SECRETS ARE NEVER STORED IN THE CLEAR. value_encrypted holds AES-256-GCM output keyed by
-- INTEGRATION_SECRETS_KEY, which lives only in the environment. A database dump - including the
-- production copies routinely restored for analysis - carries ciphertext that is useless without
-- that key. The ciphertext is also bound to its (integration, setting_key), so a value cannot be
-- copied from one row into another and still decrypt.
--
-- secret_hint is what the UI shows instead of the value: a known public prefix, the last four
-- characters and the length (e.g. "dhm_sk_...72c1 (55)"). Computed at save time, so displaying a
-- setting never requires decrypting it.

CREATE TABLE IF NOT EXISTS integration_settings (
  integration     VARCHAR(32)  NOT NULL,
  setting_key     VARCHAR(64)  NOT NULL,
  is_secret       BOOLEAN      NOT NULL DEFAULT FALSE,
  value_plain     TEXT,
  value_encrypted TEXT,
  secret_hint     VARCHAR(80),
  updated_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (integration, setting_key),
  -- A secret row may never carry a plaintext copy, and a plain row never an encrypted one.
  CONSTRAINT integration_settings_value_matches_kind CHECK (
    (is_secret AND value_plain IS NULL AND value_encrypted IS NOT NULL)
    OR (NOT is_secret AND value_encrypted IS NULL AND value_plain IS NOT NULL)
  )
);

-- Setting keys are the environment variable names (DHM_PRIVATE_KEY, JPS_API_KEY, ...), which are
-- already unique across integrations. Enforce it, so a lookup by key alone can never be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_settings_key ON integration_settings (setting_key);

-- The Integrations page. Visible to ADMIN only.
--
-- A page permission needs an explicit role_permissions row even for ADMIN: /roles/my-permissions
-- keeps only rows where a grant exists (scoped.can_view IS NOT NULL), so the "ADMIN has everything"
-- grant covers only permissions that existed when it was made. ADMIN's existing page grants come
-- in two shapes - level NULL and level 'Admin' - and both are copied here so the lateral match
-- finds one whichever way a user's level is set.
INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT 'page.integrations', 'Integrations', 'Configure DHM / JPS integration settings and credentials', 'page'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_key = 'page.integrations');

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT r.id, p.id, true, true, true, true, lv.level, NULL
FROM roles r
JOIN permissions p ON p.permission_key = 'page.integrations'
CROSS JOIN (VALUES (NULL::varchar), ('Admin'::varchar)) AS lv(level)
WHERE r.role_name = 'ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
      AND rp.level IS NOT DISTINCT FROM lv.level
      AND rp.transport_type IS NULL
  );
