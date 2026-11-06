-- KMAPS partner API: the records KLIP serves, one row per shipment as the Shipments page shows it (docs: the KMAPS repository, docs/KLIP-SHIPMENT-API.md, Draft 5).
--
-- Why a table and not a live query: the stage of a shipment is derived from the ATA ladder, own-STO milestones, SAP close flags and the OS band over the whole
-- Shipments scan, which costs seconds. KMAPS asks every 15 minutes, per vessel, and expects the complete answer each time. The table is rebuilt from that same
-- derivation by partner/refresh.ts, and the freshness is stated in GET /catalog (maxStalenessSeconds), as the contract allows.
--
-- record_id is what KMAPS keeps: opaque, issued here, never changed and never reused. The STO key the list shows is NOT the identity (an OP- / MNL- shipment gets
-- its STO number later, and a PO moved to its own operation changes the key); member_ids, the shipments.id values of the group, are what carries the identity
-- across such a change.
--
-- version only ever goes up: it is bumped when content_hash (a hash of everything the record exposes, including active / status) changes. A bare hash is not a
-- valid version because it goes up and down at random (contract 5.5).

CREATE TABLE IF NOT EXISTS partner_shipment_records (
  record_id        TEXT PRIMARY KEY,
  sto_key          TEXT,
  member_ids       UUID[] NOT NULL DEFAULT '{}',
  vessel_dhm_code  TEXT,
  vessel_sap_codes TEXT[] NOT NULL DEFAULT '{}',
  status           TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  payload          JSONB,
  content_hash     TEXT,
  version          BIGINT NOT NULL DEFAULT 1,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_active_at   TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_partner_shipment_records_updated ON partner_shipment_records (updated_at, record_id);
CREATE INDEX IF NOT EXISTS idx_partner_shipment_records_vessel ON partner_shipment_records (vessel_dhm_code) WHERE vessel_dhm_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partner_shipment_records_sap ON partner_shipment_records USING GIN (vessel_sap_codes);
CREATE INDEX IF NOT EXISTS idx_partner_shipment_records_members ON partner_shipment_records USING GIN (member_ids);
CREATE INDEX IF NOT EXISTS idx_partner_shipment_records_sto ON partner_shipment_records (sto_key) WHERE NOT deleted;
CREATE INDEX IF NOT EXISTS idx_partner_shipment_records_active ON partner_shipment_records (active) WHERE active AND NOT deleted;

-- One row: when the records were last rebuilt, and what the inputs looked like then, so a rebuild only runs when something changed (or the day turned: the stage
-- reads CURRENT_DATE).
CREATE TABLE IF NOT EXISTS partner_snapshot_state (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  signature     TEXT,
  refreshed_at  TIMESTAMPTZ,
  duration_ms   INT,
  record_count  INT,
  last_error    TEXT,
  last_error_at TIMESTAMPTZ
);
INSERT INTO partner_snapshot_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
