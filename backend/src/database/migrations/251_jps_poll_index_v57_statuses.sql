-- JPS API v5.7 (2026-10-29): after Allocated the partner status goes Berthed -> Start Cargo -> Cargo Done -> Sailed Off, and Sailed was renamed Sailed Off.
--
-- The poller (jps/poll.ts) and the partial index behind it knew only Pending / Approved / Allocated, so an instruction that reached Berthed would no longer have been polled:
-- the cargo window (Hose On / Hose Off, which become ATS / ATC Discharge) and the departure would have reached KLIP only if the JPS webhook was registered.
-- The poller now reads JPS_LIVE_STATUSES (jps/types.ts); this rebuilds the index on the same predicate, so the due-for-polling lookup stays an index scan.
-- Terminal, and so not in it: Rejected, Deleted, Sailed Off, and the older Sailed.

DROP INDEX IF EXISTS idx_jps_si_poll;
CREATE INDEX IF NOT EXISTS idx_jps_si_poll
  ON jps_shipping_instructions (last_polled_at NULLS FIRST)
  WHERE state = 'SUBMITTED' AND jps_status IN ('Pending', 'Approved', 'Allocated', 'Berthed', 'Start Cargo', 'Cargo Done');
