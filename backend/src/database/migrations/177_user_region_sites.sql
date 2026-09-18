-- User Region/Site scope, stored as what the admin actually picked.
--
-- THE BUG THIS EXISTS FOR. The Users page picker has always listed SAP Discharge Destination -
-- /contracts/filter-options/group-plants is REGION_SITE_FILTER_OPTIONS_SQL, the same list the
-- Region/Site dropdown on Shipments uses. But syncUserPlants then round-tripped that choice through
-- master_plants.group_plant to store a foreign key, and those are two different dimensions that
-- happen to share four labels:
--
--   group_plant label        is it a discharge destination?
--   Bekasi, Bontang,         yes - 4 of 14
--   Karawang, Tanjung Pura
--   Bulking Lubuk Gaung      NO  (SAP says LUBUK GAUNG, 3,251 rows)
--   Bulking Batam            NO  (SAP says BATAM, 216)
--   Bulking Kumai            NO  (KUMAI, 520)
--   Bulking Palembang        NO  (PALEMBANG, 216)
--   Bulking Belawan          NO  (BELAWAN, 8)
--   EOP Tj Morawa            NO  (TANJUNG MORAWA, 2,030)
--   Cisadane                 NO  (TANGERANG, 708)
--   Bulking Sintang          NO  (its plants have no SAP rows at all)
--   Trading                  NO  (spread across 8+ destinations)
--
-- So an admin picking LUBUK GAUNG had it silently dropped - the only trace was a logger.warn - and
-- that user opened Shipments scoped to nothing. The four that DID match stored the plant-dimension
-- spelling, which then filtered by destination and hid real work: Bontang plants also ship to
-- MERAUKE (15 rows), TRADING TRANSIT HO (2) and KUMAI (1), and none of those showed.
--
-- NOT BACKFILLED, decided by Ryan 2026-09-18. The scope is a default filter and an alert scope, not
-- an access boundary - nothing server-side enforces it on a page query - so starting empty widens
-- what people see rather than locking anyone out, and every existing assignment was drawn from the
-- wrong dimension anyway. Admins re-assign from the picker, which was always showing the right list.
--
-- user_plants is left in place and simply stops being the source for this. Its rows are cleared as
-- each user is next saved, so nothing is silently read from a dimension we no longer mean.

CREATE TABLE IF NOT EXISTS user_region_sites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  region_site text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, region_site)
);

CREATE INDEX IF NOT EXISTS idx_user_region_sites_user ON user_region_sites (user_id);
