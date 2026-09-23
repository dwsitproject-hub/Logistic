-- Master Vessel cleansing, from "Vessel Cleanup (Jovin, Klip, SAP).xlsx".
--
-- Ryan named that workbook the source of truth on 2026-09-23. Reconciling it against a copy of
-- production found 9 alias codes sitting on a different vessel than the workbook says, and for
-- the three below the SAP transaction rows agree with the WORKBOOK, not with KLIP:
--
--   MBERLIAN   49 SAP rows named "BERLIAN PACIFIC III", filed under MT. GIAT ARMADA 02
--   MPACSTAR   25 SAP rows named "PACIFIC STAR 1",      filed under BG. PACIFIC STAR 3
--   MARCADIA    3 SAP rows named "MT.ARCADIA",          filed under SMS 3000
--
-- The other six differ only in which half of a tug/barge pair the code names. The workbook keeps
-- tug and barge as SEPARATE vessels, each with its own codes - BG. CITRA 45001 has MCITRA45 while
-- TB. CITRA 07 has MCITRA07 - and Ryan chose that model, so KLIP follows it here.
--
-- Where one code was listed against two vessels in the workbook, the rule Ryan gave is: take the
-- row sourced from Jovin. That settled six of eight. The remaining two had two Jovin rows and were
-- settled on attribute completeness (MT. KOAN over BG. MT KOAN) and on being one vessel entered
-- twice (BG. PENATA BESAR I).
--
-- The workbook spells two of these from a truncated SAP column - "BG. PRIMA SAMUD" and, mangled
-- further, "TK. G. PON 1". Both codes in fact name the TUG of their pair (MPRIMASAK8 from PRIMA
-- SAKTI VIII, MBEATRICE1 from BEATRICE 01), so under the tug-and-barge-are-separate model they
-- belong to TB. PRIMA SAKTI VIII and TB. BEATRICE 01, and the truncated barge names do not arise.
--
-- WHAT MOVES, measured on the production copy: 7 vessels created, 5 duplicate pairs merged, and
-- 94 shipments re-attributed - 50 from MT. GIAT ARMADA 02 to BG. BERLIAN PACIFIC III, 22 from
-- BG. PACIFIC STAR 3 to BG. PACIFIC STAR 1, 10 from CITRA 45001 to TB. CITRA 07, and the rest in
-- ones and threes. Afterwards no vessel name is stored twice, no vessel has two primary codes, and
-- every vessel code appearing in sap_processed_data resolves to a vessel (3 did not before).
--
-- No quantity, outstanding or status calculation is touched - only which vessel a shipment is
-- attributed to, which shows on Shipping Performance, Vessel Idle and Vessel History.
--
-- Runs after 182, so normalize_vessel_name() already strips SPOB./TKG. and treats a tongkang
-- segment as cargo. That fix also collapses three vessels stored twice - SPOB. DELTA VICTORY 08,
-- SPOB. JULVINDA and SPOB. REZEKI BERSAMA each now key on the same name as their prefix-less twin
-- - so step 2 below merges five pairs, not the two that were visible before 182.

-- The decision register, as data. code -> the vessel the workbook says owns it.
CREATE TEMP TABLE vessel_cleanup_plan (sap_code text, vessel_name text, note text) ON COMMIT DROP;

INSERT INTO vessel_cleanup_plan (sap_code, vessel_name, note) VALUES
  -- Mis-assigned: SAP's own vessel name agrees with the workbook, not with KLIP.
  ('MBERLIAN',   'BG. BERLIAN PACIFIC III', 'was MT. GIAT ARMADA 02'),
  ('MPACSTAR',   'BG. PACIFIC STAR 1',      'was BG. PACIFIC STAR 3'),
  ('MARCADIA',   'MT. ARCADIA',             'was SMS 3000'),
  -- Tug half of a pair, filed under the barge.
  ('MCITRA07',   'TB. CITRA 07',            'was CITRA 45001'),
  ('MMARINA9',   'TB. AS MARINA 9',         'was BG. AS MARINA 12'),
  -- Known to SAP but never mapped in KLIP.
  ('MMARINA11',  'TB. AS MARINA 11',        'unmapped SAP code'),
  ('MPRIMASAK8', 'TB. PRIMA SAKTI VIII',    'unmapped; the code names the tug, its barge is BG. PRIMA SAMUDR'),
  ('MBEATRICE1', 'TB. BEATRICE 01',         'unmapped; the code names the tug, its barge is TKG. PON 1'),
  ('MJAYASEJA1', 'BG. JAYA SEJAHTERA I',    'workbook code absent from KLIP'),
  -- One code listed against two vessels in the workbook; Jovin-sourced row wins.
  ('MPRIMA91',   'BG. PRIMA SAMUDRA IX',    'over TB. TIRTA BAHARI 03'),
  ('MSINAR',     'BG. SINAR BAHAGIA 02',    'over SINAR JOHOR'),
  ('MGOLDEN',    'MT. GOLDEN MERCURY',      'over GOLDEN FLAME'),
  ('MFALCON',    'BG. FALCON STAR 1',       'over FALCON'),
  ('MTOB26',     'BG. SWISS BORNEO 271106', 'over BG. SWISS BORNEO 27110'),
  ('MDAYA',      'MT. DAYA ARMADA 01',      'over DAYA MAJU'),
  -- Two Jovin rows; settled on completeness / one vessel entered twice.
  ('MKOAN',      'MT. KOAN',                'over BG. MT KOAN - tanker, 3300 MT, DHDB'),
  ('MMPENATA.B', 'BG. PENATA BESAR I',      'over BG. PENATA BESAR 1 - same owner, size, hull');

ALTER TABLE vessel_cleanup_plan ADD COLUMN norm_name text;
UPDATE vessel_cleanup_plan SET norm_name = normalize_vessel_name(vessel_name);

-- 1. Free the legacy primary code from any vessel that is about to lose it. master_vessels
--    .vessel_code is UNIQUE, so it has to be released before it can be granted.
--
--    Prefer another SAP code the vessel still owns - MT. GIAT ARMADA 02 gives up MBERLIAN but
--    keeps MARMADA02, so it stays OFFICIAL. Only a vessel left with no code at all drops to
--    PROVISIONAL, which is what the workbook says about BG. PACIFIC STAR 3: it has none.
--
--    The placeholder carries the row id because the plain slug is not free. BG. PACIFIC STAR 3
--    is stored twice, and the PROVISIONAL twin already holds TMP-PACIFICSTAR3. Step 2 merges the
--    pair by name a few statements later, so the placeholder only has to survive until then.
WITH losing AS (
  SELECT mv.id,
         mv.normalized_vessel_name,
         (SELECT upper(trim(a.vessel_code))
          FROM master_vessel_code_aliases a
          WHERE a.master_vessel_id = mv.id
            AND upper(trim(a.vessel_code)) <> upper(trim(mv.vessel_code))
            AND upper(trim(a.vessel_code)) NOT IN (SELECT upper(trim(sap_code)) FROM vessel_cleanup_plan)
          ORDER BY a.is_primary DESC, a.created_at NULLS LAST
          LIMIT 1) AS kept_code
  FROM master_vessels mv
  WHERE upper(trim(mv.vessel_code)) IN (SELECT upper(trim(sap_code)) FROM vessel_cleanup_plan)
    AND mv.normalized_vessel_name NOT IN (SELECT norm_name FROM vessel_cleanup_plan)
)
UPDATE master_vessels mv
SET vessel_code = COALESCE(
      losing.kept_code,
      left('TMP-' || regexp_replace(losing.normalized_vessel_name, '[^A-Z0-9]', '', 'g'), 40)
        || '-' || left(replace(mv.id::text, '-', ''), 6)
    ),
    code_status = CASE WHEN losing.kept_code IS NULL THEN 'PROVISIONAL' ELSE mv.code_status END,
    updated_at = CURRENT_TIMESTAMP
FROM losing
WHERE mv.id = losing.id;

-- 2. Collapse vessels stored twice under the same normalized name, before anything is promoted.
--    Five pairs on the production copy. BG. JAYA SEJAHTERA I and BG. PACIFIC STAR 3 were each
--    stored as an OFFICIAL row plus a PROVISIONAL one, and uq_master_vessels_normalized_name_official
--    only covers OFFICIAL rows, so they slipped past it. The other three - DELTA VICTORY 08,
--    JULVINDA, REZEKI BERSAMA - only become visible once 182 strips the SPOB. prefix.
--
--    This has to happen BEFORE step 4 promotes anything to OFFICIAL, or that promotion trips the
--    very index the duplicates were hiding from.
--
--    Survivor: OFFICIAL first, then whichever row carries more shipments, then the oldest.
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT keep.id AS keep_id, drop_row.id AS dup_id
    FROM (
      SELECT DISTINCT ON (normalized_vessel_name) id, normalized_vessel_name
      FROM master_vessels
      ORDER BY normalized_vessel_name,
               CASE WHEN code_status = 'OFFICIAL' THEN 0 ELSE 1 END,
               (SELECT count(*) FROM shipments s WHERE s.master_vessel_id = master_vessels.id) DESC,
               created_at NULLS LAST,
               id
    ) keep
    INNER JOIN master_vessels drop_row
      ON drop_row.normalized_vessel_name = keep.normalized_vessel_name
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

-- 3. Create the vessels the workbook names that KLIP does not have yet.
INSERT INTO master_vessels (vessel_code, vessel_name, normalized_vessel_name, code_status)
SELECT p.sap_code, p.vessel_name, p.norm_name, 'OFFICIAL'
FROM vessel_cleanup_plan p
WHERE NOT EXISTS (
  SELECT 1 FROM master_vessels mv WHERE mv.normalized_vessel_name = p.norm_name
);

-- 4. Adopt the workbook's spelling, and promote to OFFICIAL now that a real SAP code is attached.
UPDATE master_vessels mv
SET vessel_name = p.vessel_name,
    code_status = 'OFFICIAL',
    updated_at = CURRENT_TIMESTAMP
FROM vessel_cleanup_plan p
WHERE mv.normalized_vessel_name = p.norm_name
  AND (mv.vessel_name IS DISTINCT FROM p.vessel_name OR mv.code_status <> 'OFFICIAL');

-- 5. Point each code at the vessel the workbook names. The alias table is the authority for
--    PO -> vessel mapping, so this is the operative step. The vessel_code update below only keeps
--    the legacy column from contradicting it in the lateral join's fallback branch.
INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, is_primary, namespace)
SELECT mv.id, p.sap_code, 'workbook_cleanup', false, 'SAP'
FROM vessel_cleanup_plan p
INNER JOIN master_vessels mv ON mv.normalized_vessel_name = p.norm_name
ON CONFLICT (vessel_code) DO UPDATE SET
  master_vessel_id = EXCLUDED.master_vessel_id,
  namespace = 'SAP',
  -- A moved code may have been its old vessel's primary, and the new vessel already has one.
  -- uq_master_vessel_code_aliases_one_primary (181) forbids two; the last step re-elects one.
  is_primary = false,
  updated_at = CURRENT_TIMESTAMP;

UPDATE master_vessels mv
SET vessel_code = p.sap_code,
    updated_at = CURRENT_TIMESTAMP
FROM vessel_cleanup_plan p
WHERE mv.normalized_vessel_name = p.norm_name
  AND upper(trim(mv.vessel_code)) IS DISTINCT FROM upper(trim(p.sap_code))
  AND NOT EXISTS (
    SELECT 1 FROM master_vessels other
    WHERE upper(trim(other.vessel_code)) = upper(trim(p.sap_code)) AND other.id <> mv.id
  );

-- 6. Re-point shipments carrying one of the codes above, and only those.
--
--    shipments.master_vessel_id is a denormalized cache that sqlResolveMasterVesselIdFromShipment
--    consults BEFORE the alias table, so a stale value wins over the mapping this migration just
--    corrected. It still has to be narrow: re-pointing every shipment from its alias moved 109
--    further vessel pairs on the production copy, because many of those ids were set by name or
--    by hand and disagree with the code for reasons this cleanup knows nothing about. Only the
--    codes in the plan are in scope here.
--
--    Shipments with no master_vessel_id are left alone - they resolve through the alias table at
--    query time and are already correct.
UPDATE shipments s
SET master_vessel_id = a.master_vessel_id,
    updated_at = CURRENT_TIMESTAMP
FROM master_vessel_code_aliases a
WHERE upper(trim(a.vessel_code)) = upper(trim(s.vessel_code))
  AND upper(trim(a.vessel_code)) IN (SELECT upper(trim(sap_code)) FROM vessel_cleanup_plan)
  AND s.master_vessel_id IS NOT NULL
  AND s.master_vessel_id IS DISTINCT FROM a.master_vessel_id;

-- 7. Finish the namespace backfill that 181 could only start. 181 could prove a code was SAP only
--    by finding it in sap_processed_data; codes that exist in SAP's master but have not yet
--    appeared on a transaction stayed LEGACY. The workbook lists them, so they are named here.
--    Everything still LEGACY afterwards is a code invented inside KLIP by hand.
UPDATE master_vessel_code_aliases
SET namespace = 'SAP', updated_at = CURRENT_TIMESTAMP
WHERE namespace = 'LEGACY'
  AND upper(trim(vessel_code)) IN (
    'MANDALAN','MANUGRAH','MARCTK1','MBHSB3','MBINPER1','MBMB','MCAMAR1','MDELTA.V08','MFORT',
    'MFPS21A','MILIR3','MILIR8','MILIR9','MJULVINDA','MKAN4','MKAPMAR','MKENC7','MKENCEX','MLUM1',
    'MMAJESTY','MMAK21','MMAKXVI','MMANOG','MMAR2','MMARAB','MMARSATU','MMARVI','MMMAK10','MMULTI',
    'MPANGERAN','MPOTENG','MPRIMA7','MPUTGAN','MROYAL3','MROYAL7','MSAHAB24','MSAHAB31','MSAHAB38',
    'MSAHAB4','MSAHABKAP','MSAHKAP5','MSBU88','MSEN2501','MSENGBRD','MSIL','MSMB1','MSMB2',
    'MSUMKAP212','MWID3500'
  );

UPDATE master_vessel_code_aliases
SET namespace = 'KLIP', updated_at = CURRENT_TIMESTAMP
WHERE namespace = 'LEGACY';

-- 8. Re-elect exactly one primary alias per vessel. Codes moved in step 5 were demoted on the way
--    out, and the five vessels created in step 3 have never had one. Same rule as 181: the alias
--    equal to master_vessels.vessel_code wins, then the oldest.
WITH ranked AS (
  SELECT a.id,
         row_number() OVER (
           PARTITION BY a.master_vessel_id
           ORDER BY
             CASE WHEN upper(trim(a.vessel_code)) = upper(trim(mv.vessel_code)) THEN 0 ELSE 1 END,
             CASE WHEN a.namespace = 'SAP' THEN 0 ELSE 1 END,
             a.created_at NULLS LAST,
             a.id
         ) AS rn
  FROM master_vessel_code_aliases a
  INNER JOIN master_vessels mv ON mv.id = a.master_vessel_id
)
-- Demote first. The unique index is checked per row, so promoting the new primary before the old
-- one is cleared trips it mid-statement.
UPDATE master_vessel_code_aliases a
SET is_primary = false, updated_at = CURRENT_TIMESTAMP
FROM ranked
WHERE a.id = ranked.id AND ranked.rn > 1 AND a.is_primary;

WITH ranked AS (
  SELECT a.id,
         row_number() OVER (
           PARTITION BY a.master_vessel_id
           ORDER BY
             CASE WHEN upper(trim(a.vessel_code)) = upper(trim(mv.vessel_code)) THEN 0 ELSE 1 END,
             CASE WHEN a.namespace = 'SAP' THEN 0 ELSE 1 END,
             a.created_at NULLS LAST,
             a.id
         ) AS rn
  FROM master_vessel_code_aliases a
  INNER JOIN master_vessels mv ON mv.id = a.master_vessel_id
)
UPDATE master_vessel_code_aliases a
SET is_primary = true, updated_at = CURRENT_TIMESTAMP
FROM ranked
WHERE a.id = ranked.id AND ranked.rn = 1 AND NOT a.is_primary;
