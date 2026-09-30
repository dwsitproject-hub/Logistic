-- Restore master_plants.group_plant, which migration 195 left NULL on every row.
--
-- 195 reloaded master_plants from the CPO workbook, and the workbook has no Group Plant column.
-- groupPlantExpr (utils/groupPlantSql.ts) then resolves every contract to 'Blank'. Pre-Planned
-- excludes 'Blank', so its pool was empty and the startup rebuild superseded every SUGGESTED group
-- (68 on production, 2026-09-30).
--
-- group_plant is a business grouping (Bulking Batam, EOP Tj Morawa, Trading ...), not the new `site`
-- column: 'Trading' is what keeps trading plants out of Pre-Planned, so it cannot be derived from
-- site. The list below is production's, restored there on 2026-09-30 from a backup taken before 195
-- (docs/scripts/restore-group-plant-20260930.js). Verified on production: 0 of 19,220 contracts
-- resolve to a different Group Plant than before 195.
--
-- Only empty values are filled, so a value set since then is kept. On production this is a no-op.

UPDATE master_plants mp
SET group_plant = v.group_plant,
    updated_at = now()
FROM (VALUES
  ('BN10', 'Trading'),
  ('CD00', 'Cisadane'),
  ('CD10', 'Trading'),
  ('CD21', 'Cisadane'),
  ('CD22', 'Cisadane'),
  ('CD2A', 'Cisadane'),
  ('EO10', 'Trading'),
  ('EO21', 'EOP Tj Morawa'),
  ('EO22', 'EOP Tj Morawa'),
  ('EO2A', 'EOP Tj Morawa'),
  ('EO92', 'Bulking Belawan'),
  ('EU10', 'Trading'),
  ('EU21', 'Bulking Lubuk Gaung'),
  ('EU22', 'Bontang'),
  ('EU23', 'TJ PURA'),
  ('EU24', 'Bulking Kumai'),
  ('EU25', 'Bulking Palembang'),
  ('EU26', 'Bulking Batam'),
  ('EU27', 'Bulking Sintang'),
  ('EU2B', 'Bontang'),
  ('EU2C', 'TJ PURA'),
  ('EU2D', 'Bontang'),
  ('EU2E', 'TJ PURA'),
  ('EU2Z', 'Bekasi'),
  ('EU4B', 'Bontang'),
  ('EU4C', 'TJ PURA'),
  ('EU4D', 'Bontang'),
  ('EU4E', 'TJ PURA'),
  ('EU51', 'Bulking Lubuk Gaung'),
  ('EU52', 'Bontang'),
  ('EU53', 'TJ PURA'),
  ('EU54', 'Bulking Kumai'),
  ('EU55', 'Bulking Palembang'),
  ('EU62', 'Bontang'),
  ('EU71', 'Bulking Lubuk Gaung'),
  ('EU72', 'Bontang'),
  ('EU73', 'TJ PURA'),
  ('EU74', 'Bulking Kumai'),
  ('EU75', 'Bulking Palembang'),
  ('EU76', 'Bulking Batam'),
  ('EU77', 'Bulking Sintang'),
  ('EUL0', 'Trading'),
  ('GM10', 'Trading'),
  ('JP10', 'Trading'),
  ('JP21', 'Bekasi'),
  ('JP27', 'Bulking Lubuk Gaung'),
  ('JPL0', 'Trading'),
  ('MG10', 'Trading'),
  ('MG21', 'TJ PURA'),
  ('ND10', 'Trading'),
  ('PE10', 'Trading'),
  ('PE22', 'Bontang'),
  ('PM10', 'Trading'),
  ('PM21', 'Bulking Lubuk Gaung'),
  ('PM91', 'Bulking Lubuk Gaung'),
  ('PS10', 'Trading'),
  ('PS21', 'Bekasi'),
  ('PS22', 'Bekasi'),
  ('PS23', 'Karawang'),
  ('PS2A', 'Karawang'),
  ('PS2B', 'Karawang'),
  ('PS4A', 'Karawang'),
  ('PS4B', 'Karawang'),
  ('PSL0', 'Trading'),
  ('RB10', 'Trading'),
  ('RB21', 'TJ BUTON'),
  ('RI10', 'Trading'),
  ('RI21', 'Bekasi'),
  ('RIL0', 'Trading'),
  ('SB10', 'Trading'),
  ('SC10', 'Trading'),
  ('SC21', 'Bulking Batam'),
  ('SC22', 'Bulking Lubuk Gaung'),
  ('SC4A', 'Bulking Batam'),
  ('SC4B', 'Bulking Lubuk Gaung'),
  ('TP10', 'Trading'),
  ('TP21', 'Tanjung Langsat'),
  ('TP2A', 'Tanjung Langsat')
) AS v(plant_code, group_plant)
WHERE UPPER(TRIM(mp.plant_code)) = v.plant_code
  AND NULLIF(TRIM(mp.group_plant), '') IS NULL;

-- Migration 190 (CNF -> CFR) superseded SUGGESTED groups without releasing their members. A member
-- left active in a SUPERSEDED group holds ux_ppgm_active_contract, and every rebuild that regroups
-- that contract then fails with a duplicate key (the nightly cron included). A superseded group has
-- no active members by definition. The rebuild now also releases these itself.
UPDATE pre_planned_group_members pgm
SET released_at = now()
FROM pre_planned_groups pg
WHERE pgm.group_id = pg.id
  AND pg.status = 'SUPERSEDED'
  AND pgm.released_at IS NULL;
