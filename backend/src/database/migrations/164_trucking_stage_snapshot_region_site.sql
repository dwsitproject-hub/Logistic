-- Region/Site on the Trucking stage snapshot, so a Region/Plant filter can be answered from it.
--
-- The toolbar's Region/Plant options are DISTINCT SAP Discharge Destination
-- (REGION_SITE_FILTER_OPTIONS_SQL), but this table's `group_plant` is written by
-- groupPlantExpr('c.plant_code', 'c.company_name') - the master_plants grouping. Two different
-- dimensions, and scoping one with values from the other returned nothing: measured on dev, the
-- dropdown offers 40 values, `group_plant` holds 11, and only 4 overlap even case-insensitively
-- (BEKASI, BONTANG, KARAWANG, TANJUNG PURA). Even those failed, because the scope compared
-- case-sensitively against the stored title case - `BONTANG` matched 0 rows against `Bontang`
-- (2,237 rows), `TANJUNG PURA` 0 against `Tanjung Pura` (4,866).
--
-- `group_plant` is deliberately left in place rather than repurposed: it is a real dimension that
-- the page shows in its own right, and overwriting it would make the two indistinguishable again.
--
-- `region_site` is filled by the refresh from the *same expression the live filter uses*
-- (sqlRegionSiteRawForContract), so parity is structural rather than maintained by hand. Timed
-- over all 18,751 contracts before building this: 5.2s, against a 227s trucking build - unlike
-- the migration 163 first attempt, whose extra CTE chain took the build from 227s to 469s.
--
-- Nullable with no default, so ADD COLUMN is metadata-only and takes no rewrite. Rows written by
-- an older build read as NULL, and the loader refuses the snapshot for a Region/Plant filter
-- while any NULL remains - a silently unfiltered page is worse than a slow one.
ALTER TABLE trucking_list_stage_snapshot
  ADD COLUMN IF NOT EXISTS region_site TEXT;

-- The filter is always `UPPER(region_site) IN (UPPER($n))` scoped by contract_date, matching the
-- live form (appendRegionSiteFilter). Indexed on the same expression so the comparison is
-- sargable rather than a scan per page.
CREATE INDEX IF NOT EXISTS idx_trucking_list_stage_snapshot_region_site
  ON trucking_list_stage_snapshot (contract_date, UPPER(region_site));

-- Populate on the next refresh; until then region_site is NULL and the loader falls back to live.
UPDATE pipeline_summary_refresh_meta SET is_stale = TRUE WHERE module = 'trucking';
