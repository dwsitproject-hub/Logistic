-- Migration 127: Hub OIDC subject for SSO user mapping
ALTER TABLE users ADD COLUMN IF NOT EXISTS hub_oidc_sub VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_hub_oidc_sub
  ON users(hub_oidc_sub)
  WHERE hub_oidc_sub IS NOT NULL;
