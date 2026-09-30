-- Link each plant to Master Site using the Site column already loaded
-- from docs/Master Data - CPO 28 Sep 2026.xlsx, sheet Internal Company.

ALTER TABLE master_plants
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES master_sites(id);

UPDATE master_plants AS plant
SET site_id = site.id
FROM master_sites AS site
WHERE plant.site_id IS NULL
  AND trim(COALESCE(plant.site, '')) <> ''
  AND upper(trim(plant.site)) = upper(trim(site.site_name));

CREATE INDEX IF NOT EXISTS idx_master_plants_site_id ON master_plants (site_id);
