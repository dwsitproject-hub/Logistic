-- normalize_vessel_name(): recognise SPOB. and TKG., and treat tongkang segments as cargo.
--
-- Keeps this function aligned with normalizeVesselName() in vesselNameNormalize.ts, which changed
-- in the same commit. Two faults, both found while reconciling the master against the cleanup
-- workbook on 2026-09-23:
--
-- 1. `TK` was tried before `TKG`, so `TKG. PON 1` lost only the `TK` and normalized to `G PON 1`.
--    The workbook records that vessel as "TK. G. PON 1" - the mangling came from here, not from
--    whoever built the sheet. Longest alternatives now come first.
--
-- 2. Only `BG.` and `MT.` counted as cargo-carrying segments of a tug/barge compound. `TK.`/`TKG.`
--    (tongkang) and `SPOB.` carry cargo just as much. With them missing, no segment of
--    `TK. SHERIN 03/TB. PACIFIC STAR I` matched and the fallback took the LAST segment - the tug.
--    So MSHERIN03 keyed on a Pacific Star name, which is part of how MPACSTAR came to sit on the
--    wrong vessel.
--
-- Measured on a copy of production before applying: 20 of 474 master rows change their
-- normalized_vessel_name, all of them SPOB. No index anywhere is built on this function, so
-- redefining it invalidates nothing.
--
-- THE RENAME CAN COLLIDE, and on SIT it did. Stripping SPOB. makes a row key on the same name as
-- its prefix-less twin, and uq_master_vessels_normalized_name_official rejects that when BOTH are
-- OFFICIAL. On the production copy one side of every such pair happened to be PROVISIONAL, so the
-- collision count read zero and this migration looked safe; SIT has SPOB. REZEKI BERSAMA and
-- REZEKI BERSAMA both OFFICIAL, and the backend crash-looped on the failed migration.
--
-- Counting collisions in one environment is not the same as handling them, so the merge below runs
-- first and folds any pair that WOULD collide - which is the right outcome anyway: they are the
-- same vessel written two ways, which is exactly what widening the prefix list set out to detect.

CREATE OR REPLACE FUNCTION normalize_vessel_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  parts text[];
  cargo text[];
  seg text;
  i int;
  last_tok text;
  roman_val text;
BEGIN
  IF p_name IS NULL THEN
    RETURN '';
  END IF;

  s := upper(trim(p_name));
  IF s = '' THEN
    RETURN '';
  END IF;

  IF position('/' in s) > 0 THEN
    parts := regexp_split_to_array(s, '\s*/\s*');
    cargo := ARRAY[]::text[];
    FOREACH seg IN ARRAY parts LOOP
      IF seg ~* '^(BG|MT|SPOB|TKG|TK)\.?\s*' THEN
        cargo := array_append(cargo, seg);
      END IF;
    END LOOP;
    IF array_length(cargo, 1) IS NOT NULL THEN
      s := cargo[array_length(cargo, 1)];
    ELSE
      s := parts[array_length(parts, 1)];
    END IF;
  END IF;

  FOR i IN 1..5 LOOP
    s := regexp_replace(s, '^(SPOB|TKG|KLM|BG|MT|TB|TK)\.?\s*', '', 'i');
  END LOOP;

  s := regexp_replace(s, '[^A-Z0-9\s]+', ' ', 'g');
  s := regexp_replace(trim(s), '\s+', ' ', 'g');
  s := regexp_replace(s, '\ySAMUDERA\y', 'SAMUDRA', 'g');

  last_tok := regexp_replace(s, '^.*\s', '');
  roman_val := CASE last_tok
    WHEN 'I' THEN '1'
    WHEN 'II' THEN '2'
    WHEN 'III' THEN '3'
    WHEN 'IV' THEN '4'
    WHEN 'V' THEN '5'
    WHEN 'VI' THEN '6'
    WHEN 'VII' THEN '7'
    WHEN 'VIII' THEN '8'
    WHEN 'IX' THEN '9'
    WHEN 'X' THEN '10'
    WHEN 'XI' THEN '11'
    WHEN 'XII' THEN '12'
    WHEN 'XIII' THEN '13'
    WHEN 'XIV' THEN '14'
    WHEN 'XV' THEN '15'
    ELSE NULL
  END;

  IF roman_val IS NOT NULL THEN
    IF s = last_tok THEN
      s := roman_val;
    ELSE
      s := regexp_replace(s, '\s' || last_tok || '$', ' ' || roman_val);
    END IF;
  END IF;

  RETURN trim(s);
END;
$$;

COMMENT ON FUNCTION normalize_vessel_name(text) IS
  'Canonical vessel-name key; must stay aligned with normalizeVesselName() in vesselNameNormalize.ts';

-- Fold vessels that the new keys would put on the same name. Grouped by the NEW key, so it catches
-- both pairs that were already duplicated and pairs this migration is about to create.
-- Survivor: OFFICIAL first, then whichever row carries more shipments, then the oldest.
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT keep.id AS keep_id, drop_row.id AS dup_id
    FROM (
      SELECT DISTINCT ON (normalize_vessel_name(vessel_name)) id,
             normalize_vessel_name(vessel_name) AS new_key
      FROM master_vessels
      WHERE NULLIF(trim(vessel_name), '') IS NOT NULL
      ORDER BY normalize_vessel_name(vessel_name),
               CASE WHEN code_status = 'OFFICIAL' THEN 0 ELSE 1 END,
               (SELECT count(*) FROM shipments s WHERE s.master_vessel_id = master_vessels.id) DESC,
               created_at NULLS LAST,
               id
    ) keep
    INNER JOIN master_vessels drop_row
      ON normalize_vessel_name(drop_row.vessel_name) = keep.new_key
     AND drop_row.id <> keep.id
  LOOP
    UPDATE master_vessel_code_aliases a
    SET master_vessel_id = dup.keep_id, is_primary = false, updated_at = CURRENT_TIMESTAMP
    WHERE a.master_vessel_id = dup.dup_id
      AND NOT EXISTS (
        SELECT 1 FROM master_vessel_code_aliases b
        WHERE b.master_vessel_id = dup.keep_id
          AND upper(trim(b.vessel_code)) = upper(trim(a.vessel_code))
      );
    DELETE FROM master_vessel_code_aliases WHERE master_vessel_id = dup.dup_id;
    UPDATE shipments SET master_vessel_id = dup.keep_id, updated_at = CURRENT_TIMESTAMP
    WHERE master_vessel_id = dup.dup_id;
    DELETE FROM master_vessels WHERE id = dup.dup_id;
  END LOOP;
END $$;

-- Stored keys were computed by the old definition, so bring them back in line. Only rows whose
-- key actually changes are touched.
UPDATE master_vessels
SET normalized_vessel_name = normalize_vessel_name(vessel_name),
    updated_at = CURRENT_TIMESTAMP
WHERE NULLIF(trim(vessel_name), '') IS NOT NULL
  AND normalized_vessel_name IS DISTINCT FROM normalize_vessel_name(vessel_name);
