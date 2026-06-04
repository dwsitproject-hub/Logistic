-- Update safe_to_numeric function to handle whitespace and newlines
CREATE OR REPLACE FUNCTION safe_to_numeric(val TEXT) RETURNS NUMERIC AS $$
BEGIN
  IF val IS NULL OR TRIM(val) = '' OR UPPER(TRIM(val)) IN ('N/A', 'NA', '-', 'NULL', 'NONE') THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN REPLACE(REPLACE(REPLACE(TRIM(val), ',', ''), E'\r', ''), E'\n', '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

