-- JPS partner API v5.0: record the approval and berthing milestones the enriched GET now returns.
--
-- v5.0 adds `plan_reference`, `approval`, `etr_minutes`, `allocation.jetty_code` and a `schedule`
-- block carrying TA, ETB, TB, ETC, TC, cast off and sailed. It also adds a fourth partner status,
-- `Sailed`, so the lifecycle is Pending -> Approved/Rejected -> Allocated -> Sailed.
--
-- STORED SEPARATELY FROM KLIP'S OWN ATA FIELDS, deliberately. `shipments` already carries arrival,
-- berthed, start and complete times, written by SAP and by users through Edit Shipment, with merge
-- rules protecting the KLIP values from being overwritten. JPS is a third source for the same
-- moments. Writing it into those columns would fold a new opinion into rules that already take
-- care to keep two apart; keeping it here lets the two be compared before anyone decides whether
-- one should correct the other.
--
-- Every column is nullable. A v4.x response simply leaves them NULL, which is why this can ship
-- before JPS starts sending v5.0 payloads.

ALTER TABLE jps_shipping_instructions
  -- JPS's own plan id, e.g. SP-26-09-00010. Useful when talking to their operators.
  ADD COLUMN IF NOT EXISTS plan_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS jetty_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS etr_minutes INT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  -- The schedule block, prefixed so a reader never mistakes these for KLIP's own ATA columns.
  ADD COLUMN IF NOT EXISTS schedule_eta TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_ta TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_etb TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_tb TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_etc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_tc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_cast_off_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_sailed_at TIMESTAMPTZ;

-- The poller stopped at Allocated, because that was the end of the story in v4.2. In v5.0 the
-- milestones arrive AFTER allocation, so stopping there would mean never seeing them. Rejected and
-- Sailed are the terminal states now.
DROP INDEX IF EXISTS idx_jps_si_poll;
CREATE INDEX IF NOT EXISTS idx_jps_si_poll
  ON jps_shipping_instructions (last_polled_at NULLS FIRST)
  WHERE state = 'SUBMITTED' AND jps_status IN ('Pending', 'Approved', 'Allocated');
