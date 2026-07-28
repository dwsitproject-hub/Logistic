-- SAP presence state (Phase 2: act on absence).
--
-- Phase 1 recorded which (po_number, sto_number) rows stopped appearing in the daily SAP
-- Report. This adds the state that read paths act on.
--
-- Design constraints that shaped this:
--   * The flag lives on contracts as a plain column so queries filter it with a column
--     predicate on rows they already scan. It must never become a correlated lookup into
--     sap_processed_data - that shape took the shipments list from 34s to 120s on 2026-07-27.
--   * Nothing is deleted. Withdrawn contracts keep their KLIP planning, ATAs and remarks,
--     stay visible behind a filter, and flip back to PRESENT if the PO returns.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS sap_presence varchar(16) NOT NULL DEFAULT 'PRESENT',
  ADD COLUMN IF NOT EXISTS sap_withdrawn_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS sap_withdrawn_reason text;

ALTER TABLE contracts
  DROP CONSTRAINT IF EXISTS contracts_sap_presence_check;
ALTER TABLE contracts
  ADD CONSTRAINT contracts_sap_presence_check
  CHECK (sap_presence IN ('PRESENT', 'WITHDRAWN'));

-- Partial index: the overwhelming majority of rows are PRESENT, so only index the exceptions.
-- Aggregate queries add "AND sap_presence = 'PRESENT'", which the planner satisfies from the
-- column itself; this index serves the "show me withdrawn only" filter.
CREATE INDEX IF NOT EXISTS idx_contracts_sap_presence_withdrawn
  ON contracts (sap_presence)
  WHERE sap_presence <> 'PRESENT';

COMMENT ON COLUMN contracts.sap_presence IS
  'PRESENT = in the latest SAP Report. WITHDRAWN = absent from 2+ consecutive trusted imports, i.e. cancelled or deleted in SAP. Excluded from totals, still visible behind a filter, KLIP-entered data preserved read-only.';

-- STO-level supersession. A row keyed (PO-A, STO) that vanished while the STO reappeared under
-- PO-B was moved, not cancelled; a blank-STO row left behind once SAP assigned the STO is
-- routine bookkeeping. Either way the stale row must stop competing in "latest row" lookups.
ALTER TABLE sap_processed_data
  ADD COLUMN IF NOT EXISTS superseded_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS superseded_reason varchar(32),
  ADD COLUMN IF NOT EXISTS superseded_by_po varchar(100);

CREATE INDEX IF NOT EXISTS idx_spd_superseded
  ON sap_processed_data (superseded_at)
  WHERE superseded_at IS NOT NULL;

COMMENT ON COLUMN sap_processed_data.superseded_reason IS
  'SUPERSEDED_BY_STO = blank-STO row replaced once SAP assigned the STO. STO_MOVED = this STO now sits under superseded_by_po.';

-- Audit trail: every presence transition, so a withdrawal can be explained and reversed.
CREATE TABLE IF NOT EXISTS sap_presence_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id  uuid REFERENCES contracts(id) ON DELETE CASCADE,
  po_number    varchar(100),
  from_state   varchar(16),
  to_state     varchar(16),
  reason       text,
  import_id    uuid,
  actor        varchar(64) NOT NULL DEFAULT 'sap-import',
  created_at   timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sap_presence_audit_contract
  ON sap_presence_audit (contract_id, created_at DESC);
