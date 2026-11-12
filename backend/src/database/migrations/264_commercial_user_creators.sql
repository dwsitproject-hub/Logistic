-- Which SAP user (NIK) a COD account is, set by an administrator on Users > Edit user. It decides the "Created by" that the Documents page pre-selects
-- for that person; without a row the page falls back to matching the name (see utils/creatorMatch.ts).
-- A separate table, not a column on users: users is shared with KLIP and this is COD's own setting.

CREATE TABLE IF NOT EXISTS commercial_user_creators (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sap_user_id TEXT NOT NULL,
  set_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  set_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
