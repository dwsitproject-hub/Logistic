-- Complete Master Site and link every plant to its site.
--
-- Migration 207 cut Master Site down to the 7 sites that sit next to a Company Name starting with
-- PT, and 208 then reloaded Master Plant (31 rows) and linked a plant only when its site survived.
-- The other 18 plants kept their Site text but lost the site row, so Master Plant Sync answered
-- "Plant needs a DHM site." for them (13 of 31 synced, 2026-10-01).
--
-- The unique values of the Site column on docs/Master Data - CPO 28 Sep 2026.xlsx, sheet Internal
-- Company, are the 18 sites below; city and postal code match migration 200 exactly (checked
-- against the current sheet, 0 differences). This puts back the ones 207 removed.
--
-- Additive only, and safe to run twice:
--   1. a site that already exists (by name) is left exactly as it is, including company_name and
--      any DHM code, so the 7 sites kept by 207 are not touched;
--   2. company <-> site links come from the seed of migration 204, which 207's DELETE removed
--      through ON DELETE CASCADE. A site cannot be pushed to DHM without its company;
--   3. plants whose Site text matches a site but have no link yet get site_id.
-- Plants with a blank Site are not guessed.

INSERT INTO master_sites (site_name, city, postal_code)
VALUES
  ('BATAM', 'BATAM', '29444'),
  ('BEKASI', 'BEKASI', '17131'),
  ('BONTANG', 'BONTANG', '75325'),
  ('GRESIK', 'GRESIK', '61119'),
  ('KARAWANG', 'KARAWANG', '41361'),
  ('KUMAI', 'KUMAI', '74181'),
  ('LUBUK GAUNG', 'DUMAI', '28826'),
  ('PALEMBANG', 'PALEMBANG', '30961'),
  ('PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700'),
  ('PROBOLINGGO', 'DKI JAKARTA', '10330'),
  ('RIAU', 'DKI JAKARTA', '10350'),
  ('SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920'),
  ('SIDOARJO', 'SIDOARJO', NULL),
  ('TANGERANG', 'TANGERANG', '15115'),
  ('TANJUNG BUTON', 'PEKAN BARU', '28662'),
  ('TANJUNG MORAWA', 'TANJUNG MORAWA', '20362'),
  ('TANJUNG PURA', 'TANJUNG PURA', '78371'),
  ('TRADING TRANSIT HO', NULL, NULL)
ON CONFLICT (upper(trim(site_name))) DO NOTHING;

INSERT INTO master_company_sites (company_id, site_id)
SELECT company.id, site.id
FROM (VALUES
  ('AC', 'BONTANG'),
  ('AM', 'BONTANG'),
  ('BN', 'PROBOLINGGO'),
  ('BU', 'TANJUNG PURA'),
  ('CD', 'TANGERANG'),
  ('CM', 'BONTANG'),
  ('CR', 'KARAWANG'),
  ('CR', 'TANJUNG PURA'),
  ('EO', 'BONTANG'),
  ('EO', 'TANJUNG MORAWA'),
  ('EU', 'BATAM'),
  ('EU', 'BONTANG'),
  ('EU', 'KARAWANG'),
  ('EU', 'KUMAI'),
  ('EU', 'LUBUK GAUNG'),
  ('EU', 'PALEMBANG'),
  ('EU', 'TANJUNG PURA'),
  ('GM', 'SELANGOR'),
  ('GN', 'TANJUNG PURA'),
  ('HS', 'BONTANG'),
  ('JJ', 'LUBUK GAUNG'),
  ('JP', 'GRESIK'),
  ('JP', 'SIDOARJO'),
  ('JP', 'TANGERANG'),
  ('KU', 'LUBUK GAUNG'),
  ('PM', 'LUBUK GAUNG'),
  ('PN', 'BONTANG'),
  ('PS', 'BEKASI'),
  ('PS', 'KARAWANG'),
  ('PT', 'BONTANG'),
  ('PT', 'TANJUNG PURA'),
  ('RB', 'RIAU'),
  ('RB', 'TANJUNG BUTON'),
  ('RI', 'BEKASI'),
  ('SA', 'BONTANG'),
  ('SA', 'TANJUNG PURA'),
  ('SC', 'LUBUK GAUNG'),
  ('SI', 'TRADING TRANSIT HO'),
  ('TH', 'BONTANG'),
  ('TP', 'PASIR GUDANG'),
  ('TS', 'BONTANG'),
  ('TS', 'TANJUNG PURA'),
  ('WS', 'BONTANG'),
  ('WW', 'BONTANG'),
  ('WW', 'TANJUNG PURA')
) AS seed(company_code, site_name)
JOIN master_companies company ON upper(trim(company.company_code)) = upper(trim(seed.company_code))
JOIN master_sites site ON upper(trim(site.site_name)) = upper(trim(seed.site_name))
ON CONFLICT DO NOTHING;

UPDATE master_plants AS plant
SET site_id = site.id
FROM master_sites AS site
WHERE plant.site_id IS NULL
  AND trim(COALESCE(plant.site, '')) <> ''
  AND upper(trim(plant.site)) = upper(trim(site.site_name));
