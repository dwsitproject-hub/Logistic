-- Keep SQL matching in sync with backend/src/utils/vesselNameNormalize.ts
CREATE OR REPLACE FUNCTION normalize_vessel_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text;
  parts text[];
  sea text[];
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
    sea := ARRAY[]::text[];
    FOREACH seg IN ARRAY parts LOOP
      IF seg ~* '^(BG|MT)\.?\s*' THEN
        sea := array_append(sea, seg);
      END IF;
    END LOOP;
    IF array_length(sea, 1) IS NOT NULL THEN
      s := sea[array_length(sea, 1)];
    ELSE
      s := parts[array_length(parts, 1)];
    END IF;
  END IF;

  FOR i IN 1..5 LOOP
    s := regexp_replace(s, '^(BG|MT|TB|KLM|TK)\.?\s*', '', 'i');
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
