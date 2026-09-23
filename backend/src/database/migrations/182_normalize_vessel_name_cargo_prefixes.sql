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
-- normalized_vessel_name, all of them SPOB. and all still PROVISIONAL, and the partial unique
-- index uq_master_vessels_normalized_name_official gains ZERO collisions. No index anywhere is
-- built on this function, so redefining it invalidates nothing.

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

-- Stored keys were computed by the old definition, so bring them back in line. Only rows whose
-- key actually changes are touched.
UPDATE master_vessels
SET normalized_vessel_name = normalize_vessel_name(vessel_name),
    updated_at = CURRENT_TIMESTAMP
WHERE NULLIF(trim(vessel_name), '') IS NOT NULL
  AND normalized_vessel_name IS DISTINCT FROM normalize_vessel_name(vessel_name);
