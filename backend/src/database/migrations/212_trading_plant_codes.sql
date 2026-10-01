-- Plant codes that are trading plants, kept outside master_plants so a reload of Master Plant
-- cannot lose them.
--
-- Group Plant is now the contract's SAP Discharge Destination (utils/groupPlantSql.ts), not
-- master_plants.group_plant. One value still has to come from the plant: 'Trading'. Pre-Planned
-- leaves Trading out of auto-grouping (config/prePlannedConfig.ts excludes 'Blank' and 'Trading'),
-- and a trading plant's contracts are delivered to 40+ different destinations, so the destination
-- cannot tell them apart. SAP sends only the Plant Code, not its type.
--
-- The 26 codes below are every plant of type HO TRADING / HO TRADING INTERDIVISION (or labelled
-- Trading) in the Master Plant that production had before migrations 195 and 208 reloaded it down
-- to 31 rows. Their contracts are 1,523 of 19,053, the same set the old 'Trading' group held.
-- groupPlantExpr also treats any master_plants row whose plant_type starts with HO TRADING as
-- trading, so a plant added later through the Master Plant page needs no row here.

CREATE TABLE IF NOT EXISTS trading_plant_codes (
  plant_code VARCHAR(50) PRIMARY KEY,
  plant_type VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO trading_plant_codes (plant_code, plant_type)
VALUES
  ('BN10', 'HO TRADING'),
  ('BN11', 'HO TRADING (NOT USED)'),
  ('CD10', 'HO TRADING'),
  ('EO10', 'HO TRADING'),
  ('EU10', 'HO TRADING'),
  ('EUL0', 'HO TRADING INTERDIVISION'),
  ('GM10', 'HO TRADING'),
  ('JN10', 'HO TRADING'),
  ('JNL0', 'HO TRADING INTERDIVISION'),
  ('JP10', 'HO TRADING'),
  ('JPL0', 'HO TRADING INTERDIVISION'),
  ('MG10', 'HO TRADING JAKARTA- MPE'),
  ('ND10', 'HO TRADING'),
  ('PE10', 'HO TRADING'),
  ('PM10', 'HO TRADING'),
  ('PS10', 'HO TRADING'),
  ('PSL0', 'HO TRADING INTERDIVISION'),
  ('PX10', 'HO TRADING JAKARTA- PEMM'),
  ('RB10', 'HO TRADING'),
  ('RF10', 'HO TRADING'),
  ('RFL0', 'HO TRADING INTERDIVISION'),
  ('RI10', 'HO TRADING'),
  ('RIL0', 'HO TRADING INTERDIVISION'),
  ('SB10', 'HO TRADING'),
  ('SC10', 'HO TRADING'),
  ('TP10', 'HO TRADING')
ON CONFLICT (plant_code) DO NOTHING;
