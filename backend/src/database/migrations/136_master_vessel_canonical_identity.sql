-- Canonical vessel identity: normalized name + code aliases
-- Merges duplicate OFFICIAL rows by normalized_vessel_name before unique index.

ALTER TABLE master_vessels
  ADD COLUMN IF NOT EXISTS normalized_vessel_name VARCHAR(255);

UPDATE master_vessels
SET normalized_vessel_name = upper(
  regexp_replace(
    regexp_replace(trim(vessel_name), '^BG\.\s*', '', 'i'),
    '^MT\.\s*', '', 'i'
  )
)
WHERE normalized_vessel_name IS NULL OR trim(normalized_vessel_name) = '';

CREATE TABLE IF NOT EXISTS master_vessel_code_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  master_vessel_id UUID NOT NULL REFERENCES master_vessels(id) ON DELETE CASCADE,
  vessel_code VARCHAR(50) NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'manual',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_master_vessel_code_aliases_code UNIQUE (vessel_code)
);

CREATE INDEX IF NOT EXISTS idx_master_vessel_code_aliases_master_id
  ON master_vessel_code_aliases (master_vessel_id);

CREATE INDEX IF NOT EXISTS idx_master_vessel_code_aliases_code_upper
  ON master_vessel_code_aliases (upper(trim(vessel_code)));

-- Merge duplicate OFFICIAL master rows sharing normalized_vessel_name (repeat until clean)
DO $$
DECLARE
  grp RECORD;
  survivor_id UUID;
  dup RECORD;
  merged_any BOOLEAN := true;
BEGIN
  WHILE merged_any LOOP
    merged_any := false;

    FOR grp IN
      SELECT normalized_vessel_name, count(*) AS cnt
      FROM master_vessels
      WHERE code_status = 'OFFICIAL'
        AND normalized_vessel_name IS NOT NULL
        AND trim(normalized_vessel_name) <> ''
      GROUP BY normalized_vessel_name
      HAVING count(*) > 1
    LOOP
      merged_any := true;

      SELECT mv.id INTO survivor_id
      FROM master_vessels mv
      WHERE mv.normalized_vessel_name = grp.normalized_vessel_name
        AND mv.code_status = 'OFFICIAL'
      ORDER BY
        CASE WHEN upper(trim(mv.vessel_code)) NOT LIKE 'TMP-%' THEN 0 ELSE 1 END,
        length(trim(mv.vessel_name)) DESC,
        mv.updated_at DESC
      LIMIT 1;

      FOR dup IN
        SELECT mv.id, mv.vessel_code
        FROM master_vessels mv
        WHERE mv.normalized_vessel_name = grp.normalized_vessel_name
          AND mv.code_status = 'OFFICIAL'
          AND mv.id <> survivor_id
      LOOP
        INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary)
        VALUES (survivor_id, upper(trim(dup.vessel_code)), 'merge_script', false)
        ON CONFLICT (vessel_code) DO UPDATE SET
          master_vessel_id = EXCLUDED.master_vessel_id,
          updated_at = CURRENT_TIMESTAMP;

        DELETE FROM master_vessels WHERE id = dup.id;
      END LOOP;

      INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary)
      SELECT survivor_id, upper(trim(mv.vessel_code)), 'db_existing', true
      FROM master_vessels mv
      WHERE mv.id = survivor_id
      ON CONFLICT (vessel_code) DO UPDATE SET
        master_vessel_id = EXCLUDED.master_vessel_id,
        is_primary = true,
        updated_at = CURRENT_TIMESTAMP;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE master_vessels
  ALTER COLUMN normalized_vessel_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_vessels_normalized_name
  ON master_vessels (normalized_vessel_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_vessels_normalized_name_official
  ON master_vessels (normalized_vessel_name)
  WHERE code_status = 'OFFICIAL';

-- Seed primary aliases from existing master vessel codes
INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary)
SELECT mv.id, upper(trim(mv.vessel_code)), 'db_existing', true
FROM master_vessels mv
WHERE NULLIF(trim(mv.vessel_code), '') IS NOT NULL
ON CONFLICT (vessel_code) DO NOTHING;

-- Shipments link to canonical master vessel (denormalized for fast joins)
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS master_vessel_id UUID REFERENCES master_vessels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_master_vessel_id
  ON shipments (master_vessel_id)
  WHERE master_vessel_id IS NOT NULL;
