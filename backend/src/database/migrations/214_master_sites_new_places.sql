-- Nine Master Sites for places that the Internal Company sheet uses and Master Site did not have.
--
-- docs/Master Data - CPO 28 Sep 2026.xlsx, sheet Internal Company, now gives 33 plants a Site that is not one of
-- the 18 Master Sites: MERAUKE 11, BOVENDIGUL 5, SALO PALAI 4, SINTANG 3, PAYA PASIR 3, BAGENDANG 2, BAYAH 2,
-- SINTETE 2, JAMBI 1. The value came from the plant's name or City. Until each exists as a Master Site a plant
-- cannot be linked to it, and a Site that does not exist cannot be pushed to DHM.
--
-- City and postal code follow the rule migration 200 used: the City on a plant whose City is the Site's own name,
-- else the most common City. A value is left NULL where the sheet is plainly wrong or cannot decide:
--   JAMBI      the sheet's postal code 75325 is BONTANG's (a copy error); Jambi's own is not on the sheet.
--   SINTETE    two plants carry two different postal codes (75382, 79453); 75382 is SALO PALAI's.
--   BOVENDIGUL the sheet's Cities are MERAUKE (2 plants) and PAPUA (3 plants); PAPUA is the most common and is a
--              province, not a town, so check it.
--   MERAUKE    3 head-office plants of ND were given this Site as their company's main Site and carry a Jakarta
--              City; they are ignored for the City and postal code.
--
-- A Site is pushed to DHM through its company (master_company_sites), so the company links are added too: every
-- company that has a plant at the Site on the sheet (EU, ND, PE, SB; all four exist from migration 204).
--
-- Additive and idempotent: an existing Site (by name) is left as it is.

INSERT INTO master_sites (site_name, city, postal_code)
VALUES
  ('MERAUKE', 'MERAUKE', '99613'),
  ('BOVENDIGUL', 'PAPUA', NULL),
  ('SALO PALAI', 'SALO PALAI', '75382'),
  ('SINTANG', 'SINTANG', '78613'),
  ('PAYA PASIR', 'PAYA PASIR', '20255'),
  ('BAGENDANG', 'BAGENDANG', '74361'),
  ('BAYAH', 'BAYAH', '42393'),
  ('SINTETE', 'KALIMANTAN BARAT', NULL),
  ('JAMBI', 'JAMBI', NULL)
ON CONFLICT (upper(trim(site_name))) DO NOTHING;

INSERT INTO master_company_sites (company_id, site_id)
SELECT company.id, site.id
FROM (VALUES
  ('EU', 'MERAUKE'), ('ND', 'MERAUKE'),
  ('EU', 'BOVENDIGUL'),
  ('PE', 'SALO PALAI'), ('SB', 'SALO PALAI'),
  ('EU', 'SINTANG'),
  ('EU', 'PAYA PASIR'),
  ('EU', 'BAGENDANG'),
  ('PE', 'BAYAH'),
  ('SB', 'SINTETE'),
  ('EU', 'JAMBI')
) AS pair(company_code, site_name)
JOIN master_companies company ON upper(trim(company.company_code)) = upper(trim(pair.company_code))
JOIN master_sites site ON upper(trim(site.site_name)) = upper(trim(pair.site_name))
ON CONFLICT DO NOTHING;

-- Plants whose Site text names one of these places and that have no link yet (none today: Master Plant holds
-- 31 plants, none of them at these places; it matters if Master Plant is reloaded from the sheet).
UPDATE master_plants AS plant
SET site_id = site.id
FROM master_sites AS site
WHERE plant.site_id IS NULL
  AND trim(COALESCE(plant.site, '')) <> ''
  AND upper(trim(plant.site)) = upper(trim(site.site_name));
