-- JPS production catalog (read 2026-11-16): the partner status has two more stages, `Hose On` (Opening) and `Hose Off` (Closing), between Berthed and Sailed Off:
-- Allocated, Berthed, Hose On, Start Cargo, Cargo Done, Hose Off, Sailed Off.
--
-- The poller (jps/poll.ts) reads JPS_LIVE_STATUSES (jps/types.ts), which now lists both, so a vessel that reached Hose On or Hose Off keeps being asked about (it has not sailed:
-- Cargo Done, the Closing time and Sailed Off still have to arrive, and by webhook only if one is registered). This rebuilds the partial index behind the due-for-polling lookup
-- on the same predicate, so it stays an index scan. Same shape as 251; the table is small, so the rebuild is instant.
-- Terminal, and so not in it: Rejected, Deleted, Sailed Off, and the older Sailed.

DROP INDEX IF EXISTS idx_jps_si_poll;
CREATE INDEX IF NOT EXISTS idx_jps_si_poll
  ON jps_shipping_instructions (last_polled_at NULLS FIRST)
  WHERE state = 'SUBMITTED' AND jps_status IN ('Pending', 'Approved', 'Allocated', 'Berthed', 'Hose On', 'Start Cargo', 'Cargo Done', 'Hose Off');
