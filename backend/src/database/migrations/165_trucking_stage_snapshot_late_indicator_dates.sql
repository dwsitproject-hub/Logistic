-- The three dates the Late Indicator is computed from, so that filter can be served from the
-- snapshot instead of forcing the whole live expansion (measured 38,931 ms).
--
-- The rule, confirmed with the business 2026-09-11: **due date delivery end against ATA**
-- (SAP Trucking Last Receive Date, or the last WB date), falling back to **ETA** (the last
-- daily-planning deliverable date), and finally to today.
--
-- **The dates are stored, not the label.** The last branch is `due < CURRENT_DATE`, so a row with
-- no receipt and a due date in the future is On Time today and Late tomorrow with no data change
-- at all. A stored label would be correct when written and quietly wrong by the next morning;
-- storing the inputs keeps CURRENT_DATE at read time, which is the only version that stays right.
--
-- The names are deliberately not the display column names. `trucking_completion_date` on a list
-- row is *not* the ATA: on shell requests it falls back to the planning date, holding 14,458
-- values where the actual holds 1,310. Storing that column failed parity on 13 of 22 Section 1
-- figures, calling past-due rows On Time because they looked received. Same-named is not
-- same-valued, so these carry their role in the name instead.
--
-- Nullable with no default, so ADD COLUMN is metadata-only and takes no rewrite. Rows written by
-- an older build read as NULL, and the loader refuses the snapshot for this filter while the
-- columns are unpopulated - a silently unfiltered page is worse than a slow one.
ALTER TABLE trucking_list_stage_snapshot
  ADD COLUMN IF NOT EXISTS late_due_date DATE,
  ADD COLUMN IF NOT EXISTS late_ata_date DATE,
  ADD COLUMN IF NOT EXISTS late_eta_date DATE;

-- Written by an earlier revision of this migration under display-column names, which turned out
-- to hold the wrong values (see above). Dropped rather than left behind, so nothing can read them
-- by mistake.
ALTER TABLE trucking_list_stage_snapshot
  DROP COLUMN IF EXISTS delivery_end_date,
  DROP COLUMN IF EXISTS trucking_completion_date,
  DROP COLUMN IF EXISTS eta_trucking_completion_date;

-- No index. The predicate is a four-branch CASE over three columns compared against CURRENT_DATE,
-- which no btree can answer; the filter runs as a scan of an already-scoped 15,562-row table, and
-- the other snapshot filters measured 20-66 ms that way. An expression index would have to be
-- rebuilt daily as CURRENT_DATE moves, which is worse than the scan it saves.

-- Populate on the next refresh; until then the columns are NULL and the loader falls back to live.
UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'trucking';
