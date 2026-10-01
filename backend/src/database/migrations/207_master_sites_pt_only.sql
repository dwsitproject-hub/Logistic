-- Keep Master Site rows that appear on Internal Company next to a Company Name
-- starting with PT (docs/Master Data - CPO 28 Sep 2026.xlsx). Store that name.
-- Plants pointing at a removed site keep their text, but lose the site link.

ALTER TABLE master_sites
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);

UPDATE master_sites
SET company_name = seed.company_name,
    updated_at = CURRENT_TIMESTAMP
FROM (
  VALUES
    ('BONTANG', 'PT. ENERGI OLEO PERSADA'),
    ('GRESIK', 'PT. JATI PERKASA NUSANTARA'),
    ('PROBOLINGGO', 'PT KPBN'),
    ('RIAU', 'PT RIAU SEMESTA BIOMASSA'),
    ('TANGERANG', 'PT. CISADANE RAYA CHEMICALS'),
    ('TANJUNG BUTON', 'PT RIAU SEMESTA BIOMASSA'),
    ('TANJUNG MORAWA', 'PT. ENERGI OLEO PERSADA')
) AS seed(site_name, company_name)
WHERE upper(trim(master_sites.site_name)) = upper(trim(seed.site_name));

UPDATE master_plants AS plant
SET site_id = NULL
WHERE site_id IN (
  SELECT id
  FROM master_sites
  WHERE upper(trim(site_name)) NOT IN (
    'BONTANG', 'GRESIK', 'PROBOLINGGO', 'RIAU', 'TANGERANG', 'TANJUNG BUTON', 'TANJUNG MORAWA'
  )
);

DELETE FROM master_sites
WHERE upper(trim(site_name)) NOT IN (
  'BONTANG', 'GRESIK', 'PROBOLINGGO', 'RIAU', 'TANGERANG', 'TANJUNG BUTON', 'TANJUNG MORAWA'
);
