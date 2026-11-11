-- COD dashboard: documents uploaded vs total, by the person who created the PO in SAP.
-- The "Created by" comes from the SAP ME2N report (Purchasing Document + Created by), which the SAP auto-import does not read, so an
-- administrator loads it from the COD dashboard. One creator per PO (the report has no PO with two). Names are optional: SAP gives an
-- employee number, and the dashboard shows the name an administrator typed for it, or the number.

CREATE TABLE IF NOT EXISTS commercial_po_creators (
  po_number   TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL,
  source_file TEXT,
  loaded_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  loaded_by   UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_commercial_po_creators_created_by ON commercial_po_creators (created_by);

CREATE TABLE IF NOT EXISTS commercial_creator_names (
  created_by   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL
);
