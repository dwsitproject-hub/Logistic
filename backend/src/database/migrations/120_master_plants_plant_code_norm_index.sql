-- Contract Performance: the late-performance and contracts-list queries resolve
-- Group Plant via LATERAL lookups on master_plants using the normalized expression
-- TRIM(UPPER(COALESCE(plant_code, ''))). Without a matching expression index this
-- seq-scans master_plants once per contract row (~1,200x per request, ~30% of query
-- time). Index changes the access path only — results verified byte-identical.
CREATE INDEX IF NOT EXISTS idx_master_plants_plant_code_norm
  ON master_plants (TRIM(UPPER(COALESCE(plant_code, '')::text)));

ANALYZE master_plants;
