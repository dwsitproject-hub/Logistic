-- Pre-Planned shipment grouping (suggested vessel groups for Unplanned contracts)
-- Spec: docs/PRE-PLANNED-GROUPING-SPEC.md

CREATE TABLE IF NOT EXISTS pre_planned_parcel_capacity (
  group_plant   TEXT PRIMARY KEY,
  parcel_mt     NUMERIC(12, 3) NOT NULL,
  sample_count  INT NOT NULL DEFAULT 0,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pre_planned_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code      TEXT UNIQUE NOT NULL,
  partition_key   TEXT NOT NULL,
  group_plant     TEXT NOT NULL,
  buyer           TEXT NOT NULL,
  incoterm        TEXT NOT NULL,
  product         TEXT NOT NULL,
  supplier        TEXT NOT NULL,
  supplier_group  TEXT,
  window_start    DATE NOT NULL,
  window_end      DATE NOT NULL,
  bin_capacity_mt NUMERIC(12, 3) NOT NULL,
  total_os_mt     NUMERIC(12, 3) NOT NULL,
  est_vessels     INT NOT NULL DEFAULT 1,
  is_partial      BOOLEAN NOT NULL DEFAULT FALSE,
  merge_hint_ids  UUID[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'SUGGESTED'
    CHECK (status IN ('SUGGESTED', 'ACCEPTED', 'DISMISSED', 'SUPERSEDED')),
  shipment_id     UUID NULL REFERENCES shipments(id) ON DELETE SET NULL,
  dismissed_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pre_planned_groups_status ON pre_planned_groups(status);
CREATE INDEX IF NOT EXISTS idx_pre_planned_groups_plant ON pre_planned_groups(group_plant);
CREATE INDEX IF NOT EXISTS idx_pre_planned_groups_partition ON pre_planned_groups(partition_key);

CREATE TABLE IF NOT EXISTS pre_planned_group_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID NOT NULL REFERENCES pre_planned_groups(id) ON DELETE CASCADE,
  contract_id       UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  contract_number   TEXT NOT NULL,
  os_mt_at_grouping NUMERIC(12, 3) NOT NULL,
  released_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, contract_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ppgm_active_contract
  ON pre_planned_group_members (contract_id)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ppgm_group ON pre_planned_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_ppgm_contract ON pre_planned_group_members(contract_id);

CREATE TABLE IF NOT EXISTS pre_planned_rebuild_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by    TEXT NOT NULL,
  groups_created  INT NOT NULL DEFAULT 0,
  groups_superseded INT NOT NULL DEFAULT 0,
  contracts_grouped INT NOT NULL DEFAULT 0,
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
