-- Connect the three internal masters with foreign keys: Master Company (Internal) <-> Master Site <-> Master Plant.
--
-- Already linked before this migration:
--   Company <-> Site    master_company_sites (company_id, site_id), both with a foreign key
--   Plant   ->  Site    master_plants.site_id -> master_sites
-- Missing, and the reason a plant and its company agreed only by spelling:
--   Plant   ->  Company master_plants carried company_code / company_name as text.
--
-- 1. master_plants.company_id -> master_companies(id), filled from the company code, else from the company name.
--    ON DELETE RESTRICT: a company that still has plants cannot be deleted.
-- 2. A BEFORE trigger on master_plants fills company_id and site_id from the text columns whenever a plant is
--    written without them, or when its text changes. Every way a plant is written goes through it: the Master Plant
--    form, the Excel upload, the DHM sync and migrations. A plant whose company or Site cannot be found keeps NULL
--    and is saved as before, so a sync of a DHM plant that has no local company is not refused.
-- 3. An AFTER trigger on master_plants keeps the company <-> Site link: a company is on every Site where it has a
--    plant, so Master Company (Internal) shows the Site and Master Site shows the Company of a new plant at once.
-- 4. An AFTER trigger on master_companies copies a changed company_code / company_name to its plants, so a rename
--    (the DHM sync renames companies) does not leave the plants spelling the old name.
--
-- Not a composite foreign key from the plant to the company <-> Site link: the DHM sync replaces a company's links,
-- and a foreign key on them would make that sync fail.
--
-- Idempotent.

ALTER TABLE master_plants
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES master_companies(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_master_plants_company_id ON master_plants (company_id);

CREATE OR REPLACE FUNCTION master_plants_resolve_links() RETURNS trigger AS $fn$
DECLARE
  resolved uuid;
BEGIN
  IF NEW.company_id IS NULL
     OR (TG_OP = 'UPDATE'
         AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
         AND (NEW.company_code IS DISTINCT FROM OLD.company_code OR NEW.company_name IS DISTINCT FROM OLD.company_name))
  THEN
    resolved := NULL;
    IF NULLIF(btrim(NEW.company_code), '') IS NOT NULL THEN
      SELECT c.id INTO resolved FROM master_companies c
       WHERE upper(btrim(c.company_code)) = upper(btrim(NEW.company_code))
       LIMIT 1;
    END IF;
    IF resolved IS NULL AND NULLIF(btrim(NEW.company_name), '') IS NOT NULL THEN
      SELECT c.id INTO resolved FROM master_companies c
       WHERE regexp_replace(regexp_replace(upper(btrim(c.company_name)), '[^A-Z0-9 ]', '', 'g'), '\s+', ' ', 'g')
           = regexp_replace(regexp_replace(upper(btrim(NEW.company_name)), '[^A-Z0-9 ]', '', 'g'), '\s+', ' ', 'g')
       ORDER BY (c.code_dhm IS NULL), c.code_dhm
       LIMIT 1;
    END IF;
    NEW.company_id := resolved;
  END IF;

  IF NEW.site_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.site_id IS NOT DISTINCT FROM OLD.site_id AND NEW.site IS DISTINCT FROM OLD.site)
  THEN
    IF NULLIF(btrim(NEW.site), '') IS NOT NULL THEN
      SELECT s.id INTO resolved FROM master_sites s
       WHERE upper(btrim(s.site_name)) = upper(btrim(NEW.site))
       LIMIT 1;
      IF resolved IS NOT NULL THEN
        NEW.site_id := resolved;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_master_plants_resolve_links ON master_plants;
CREATE TRIGGER trg_master_plants_resolve_links
  BEFORE INSERT OR UPDATE ON master_plants
  FOR EACH ROW EXECUTE FUNCTION master_plants_resolve_links();

CREATE OR REPLACE FUNCTION master_plants_link_company_site() RETURNS trigger AS $fn$
BEGIN
  IF NEW.company_id IS NOT NULL AND NEW.site_id IS NOT NULL THEN
    INSERT INTO master_company_sites (company_id, site_id) VALUES (NEW.company_id, NEW.site_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_master_plants_link_company_site ON master_plants;
CREATE TRIGGER trg_master_plants_link_company_site
  AFTER INSERT OR UPDATE ON master_plants
  FOR EACH ROW EXECUTE FUNCTION master_plants_link_company_site();

CREATE OR REPLACE FUNCTION master_companies_copy_text_to_plants() RETURNS trigger AS $fn$
BEGIN
  UPDATE master_plants
     SET company_code = NEW.company_code, company_name = NEW.company_name, updated_at = CURRENT_TIMESTAMP
   WHERE company_id = NEW.id
     AND (company_code IS DISTINCT FROM NEW.company_code OR company_name IS DISTINCT FROM NEW.company_name);
  RETURN NULL;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_master_companies_copy_text_to_plants ON master_companies;
CREATE TRIGGER trg_master_companies_copy_text_to_plants
  AFTER UPDATE OF company_code, company_name ON master_companies
  FOR EACH ROW
  WHEN (OLD.company_code IS DISTINCT FROM NEW.company_code OR OLD.company_name IS DISTINCT FROM NEW.company_name)
  EXECUTE FUNCTION master_companies_copy_text_to_plants();

-- Fill what exists. A no-op write fires the BEFORE trigger, which resolves company_id and site_id, and the AFTER
-- trigger, which adds any missing company <-> Site link.
UPDATE master_plants SET updated_at = updated_at WHERE company_id IS NULL OR site_id IS NULL;

DO $$
DECLARE
  total integer;
  no_company integer;
  no_site integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE company_id IS NULL), count(*) FILTER (WHERE site_id IS NULL)
    INTO total, no_company, no_site
    FROM master_plants;
  RAISE NOTICE 'master_plants: % plants, % without a company link, % without a Site link', total, no_company, no_site;
END $$;
