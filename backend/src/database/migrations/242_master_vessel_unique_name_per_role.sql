-- Master Vessel: a tug and a barge may share a base name.
--
-- uq_master_vessels_normalized_name_official (migration 136) let only ONE official vessel have a normalised name, and the normalised name
-- drops the TB. / BG. prefix and reads a roman numeral as its digit. The vessel master sheet (Ryan, 2026-10-15) has two real, different
-- ships that collide under it: TB. PACIFIC STAR I (a tug, paired with BG. SHERIN 03, TBG-119) and BG. PACIFIC STAR 1 (a barge, SAP code
-- MPACSTAR). Ryan approved making the rule role-aware: one official vessel per normalised name AND role (TB, BG, or none).
--
-- Less strict than the index it replaces, so it builds on any data that passed the old one. Nothing uses the old index as an ON CONFLICT
-- target. A SAP row that names such a vessel without its prefix is still resolved by its SAP code first.

DROP INDEX IF EXISTS uq_master_vessels_normalized_name_official;

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_vessels_normalized_name_role_official
  ON master_vessels (normalized_vessel_name, (COALESCE(vessel_role, '')))
  WHERE code_status = 'OFFICIAL';
