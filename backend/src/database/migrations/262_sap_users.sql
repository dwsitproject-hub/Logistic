-- SAP users (the ZUSER extract of SAP's user master): the NIK -> name behind "Created by" in the ME2N report, for COD's Dashboard > Completeness > By user.
-- Every user of the extract is kept (about 2,100), not only the people who created POs, so a new creator already has a name.
-- display_name is the name in capitals (first + last name), built when the file is loaded. `source` says who wrote the row: 'ZUSER' for the extract,
-- 'PRC' for the sync with the PRC application that is planned; a load of the extract never overwrites a row that PRC wrote (PRC wins).
--
-- commercial_creator_names (migration 260) was an empty placeholder for exactly this and is replaced by this table.

CREATE TABLE IF NOT EXISTS sap_users (
  user_id      TEXT PRIMARY KEY,
  client       TEXT,
  first_name   TEXT,
  last_name    TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  source       VARCHAR(20) NOT NULL DEFAULT 'ZUSER',
  loaded_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  loaded_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sap_users_display_name ON sap_users (display_name);

DROP TABLE IF EXISTS commercial_creator_names;
