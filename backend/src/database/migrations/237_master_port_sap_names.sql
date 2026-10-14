-- Master Port: which SAP "Vessel Port" texts belong to each port, and the Master Port id stored next to every port text.
--
-- WHY. SAP writes the Vessel Discharge / Loading Port as free text and often as a PLANT's name ("EUP EDIBLE OIL BONTANG" is 46% of the rows on the 28 Sep 2026 export),
-- so the same port shows under many spellings, and every page re-derived "which port is this" with its own rule (migration 213: alias -> Site -> "PORT <site>"; the
-- filters match raw text). The Master Port is the one place that knows. Each Master Port now carries the SAP texts that stand for it (master_port_sap_names: the column
-- "VESSEL PORT (SAP)", several values per port) and the rows that hold a port text carry the Master Port id that text resolves to:
--
--   shipments.discharge_master_port_id   <- port_of_discharge
--   shipments.loading_master_port_id     <- port_of_loading
--   vessel_loading_ports.master_port_id  <- port_name (a loading leg or a discharge leg)
--
-- The text columns are NOT changed: they stay what SAP / the user wrote. Trucking is out of scope: Truck Discharge Location and the unloading location are plants or
-- locations, not ports.
--
-- RESOLUTION (klip_resolve_master_port_id), the same identity rule as the filters (klip_port_identity = normalizeDischargePortIdentity: upper-case, punctuation to a
-- space, a leading PORT / PORT OF / JETTY / TERMINAL / PELABUHAN / DERMAGA removed):
--   1. the text IS a Master Port ("BONTANG", "PORT BONTANG", "Port of Bontang" -> PORT BONTANG); a live port before a DHM-deleted one, a PORT-prefixed name first;
--   2. otherwise the text is one of a port's VESSEL PORT (SAP) names;
--   3. otherwise NULL: no port is invented, and discharge_port_aliases (the Site rule) is deliberately NOT consulted here.
-- A SAP name is unique across all ports (one text, one port): the unique index is on its identity.
--
-- The ids are kept by BEFORE triggers on the three text columns, so every writer (SAP import, Add / Edit Shipment, PO assignment, scripts) stays in step. When the master
-- changes (a name added or removed, a port renamed or deleted) klip_refresh_master_port_ids() re-resolves every row; it sets klip.skip_updated_at so the refresh is not an
-- edit (updated_at is kept, the shared trigger function honours the setting).
--
-- Seed: sheet "Port" of "Master Data - CPO 28 Sep 2026" (klip_seed_master_port_sap_names below). Rows the sheet leaves without a PORT (EUP / TSB / PRISCOLIN trading plants)
-- are not seeded: they stay unmapped. A port the sheet names that this database does not have yet is reported by the function, not created.
--
-- Additive and idempotent.

CREATE OR REPLACE FUNCTION klip_port_identity(txt text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT REGEXP_REPLACE(
    BTRIM(REGEXP_REPLACE(UPPER(COALESCE(txt, '')), '[^A-Z0-9]+', ' ', 'g')),
    '^(PORT|JETTY|TERMINAL|PELABUHAN|DERMAGA)(\s+OF)?\s+', ''
  )
$$;

-- The shared updated_at trigger function: unchanged unless a transaction sets klip.skip_updated_at = 'on' (the Master Port id refresh).
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS trigger AS $$
BEGIN
    IF COALESCE(current_setting('klip.skip_updated_at', true), '') = 'on' THEN
        RETURN NEW;
    END IF;
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS master_port_sap_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  port_id UUID NOT NULL REFERENCES master_loading_ports(id) ON DELETE CASCADE,
  sap_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_master_port_sap_names_port ON master_port_sap_names (port_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_port_sap_names_identity ON master_port_sap_names ((klip_port_identity(sap_name)));

CREATE OR REPLACE FUNCTION klip_resolve_master_port_id(txt text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN klip_port_identity(txt) ~ '^[0-9 ]*$' OR klip_port_identity(txt) IN ('BLANK', 'DISCHARGE PORT') THEN NULL
    ELSE COALESCE(
      (SELECT p.id FROM master_loading_ports p
        WHERE klip_port_identity(p.port) = klip_port_identity(txt)
        ORDER BY COALESCE(p.dhm_is_deleted, false), (UPPER(BTRIM(p.port)) LIKE 'PORT %') DESC, LENGTH(BTRIM(p.port)), p.port
        LIMIT 1),
      (SELECT n.port_id FROM master_port_sap_names n WHERE klip_port_identity(n.sap_name) = klip_port_identity(txt) LIMIT 1)
    )
  END
$$;

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS discharge_master_port_id UUID REFERENCES master_loading_ports(id) ON DELETE SET NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS loading_master_port_id UUID REFERENCES master_loading_ports(id) ON DELETE SET NULL;
ALTER TABLE vessel_loading_ports ADD COLUMN IF NOT EXISTS master_port_id UUID REFERENCES master_loading_ports(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_discharge_master_port ON shipments (discharge_master_port_id) WHERE discharge_master_port_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_loading_master_port ON shipments (loading_master_port_id) WHERE loading_master_port_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vessel_loading_ports_master_port ON vessel_loading_ports (master_port_id) WHERE master_port_id IS NOT NULL;

CREATE OR REPLACE FUNCTION klip_shipments_set_master_port_ids() RETURNS trigger AS $$
BEGIN
  NEW.discharge_master_port_id := klip_resolve_master_port_id(NEW.port_of_discharge);
  NEW.loading_master_port_id := klip_resolve_master_port_id(NEW.port_of_loading);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION klip_vessel_loading_ports_set_master_port_id() RETURNS trigger AS $$
BEGIN
  NEW.master_port_id := klip_resolve_master_port_id(NEW.port_name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipments_master_port_ids ON shipments;
CREATE TRIGGER trg_shipments_master_port_ids
  BEFORE INSERT OR UPDATE OF port_of_discharge, port_of_loading ON shipments
  FOR EACH ROW EXECUTE FUNCTION klip_shipments_set_master_port_ids();

DROP TRIGGER IF EXISTS trg_vessel_loading_ports_master_port_id ON vessel_loading_ports;
CREATE TRIGGER trg_vessel_loading_ports_master_port_id
  BEFORE INSERT OR UPDATE OF port_name ON vessel_loading_ports
  FOR EACH ROW EXECUTE FUNCTION klip_vessel_loading_ports_set_master_port_id();

-- Re-resolve every row. Returns how many rows changed. Not an edit: updated_at is kept.
CREATE OR REPLACE FUNCTION klip_refresh_master_port_ids() RETURNS integer AS $$
DECLARE
  n_ship integer;
  n_vlp integer;
BEGIN
  PERFORM set_config('klip.skip_updated_at', 'on', true);
  UPDATE shipments s
  SET discharge_master_port_id = klip_resolve_master_port_id(s.port_of_discharge),
      loading_master_port_id = klip_resolve_master_port_id(s.port_of_loading)
  WHERE s.discharge_master_port_id IS DISTINCT FROM klip_resolve_master_port_id(s.port_of_discharge)
     OR s.loading_master_port_id IS DISTINCT FROM klip_resolve_master_port_id(s.port_of_loading);
  GET DIAGNOSTICS n_ship = ROW_COUNT;
  UPDATE vessel_loading_ports v
  SET master_port_id = klip_resolve_master_port_id(v.port_name)
  WHERE v.master_port_id IS DISTINCT FROM klip_resolve_master_port_id(v.port_name);
  GET DIAGNOSTICS n_vlp = ROW_COUNT;
  PERFORM set_config('klip.skip_updated_at', 'off', true);
  RETURN n_ship + n_vlp;
END;
$$ LANGUAGE plpgsql;

-- The seed, as a function so it can be run again (zero-deploy: SELECT * FROM klip_seed_master_port_sap_names()) after a Master Port the sheet names has been added.
-- Source: sheet "Port" of "Master Data - CPO 28 Sep 2026" as read on 2026-10-14 (21 texts whose identity differs from their port's own). It never overwrites: a text that
-- already has a port keeps it (a person's edit in Master Port wins), and a port this database does not have yet is reported, not created (a Master Port is DHM master data).
-- Rows the sheet leaves without a PORT (EUP TRADING PLANT, TSB TRADING PLANT 1, PRISCOLIN TRADING PLANT) are not listed: they stay unmapped.
CREATE OR REPLACE FUNCTION klip_seed_master_port_sap_names()
RETURNS TABLE (sap_name text, port_name text, status text)
LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
  pid uuid;
  existing_port text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('EUP EDIBLE OIL BATAM', 'PORT BATAM'),
      ('EUP EDIBLE OIL BONTANG', 'PORT BONTANG'),
      ('EUP BIOMASS BONTANG', 'PORT BONTANG'),
      ('PABRIK WKSM', 'PORT BELANG BELANG'),
      ('PABRIK AJP', 'PORT BONTANG'),
      ('SPC PALM & LAURIC LB.GAUNG', 'PORT DUMAI'),
      ('PMC BIOENERGY LB.GAUNG', 'PORT DUMAI'),
      ('PRC PALM & LAURIC KARAWANG', 'PORT MARUNDA CENTRAL (MCT)'),
      ('PRC PALM & LAURIC BEKASI', 'PORT MARUNDA CENTRAL (MCT)'),
      ('PABRIK APM', 'PORT MERAUKE'),
      ('EUP EDIBLE OIL TJ.PURA', 'PORT PELINDO KIJING'),
      ('PLANT EUP KIJING', 'PORT PELINDO KIJING'),
      ('PLANT EUP TANJUNG PURA', 'PORT PELINDO KIJING'),
      ('PABRIK SIP', 'PORT PELINDO KIJING'),
      ('CRC REFINERY TANGERANG', 'PORT TANJUNG PRIOK'),
      ('PORT OF BONEMANJING', 'PORT BONE MANJING'),
      ('EOP GENERAL BELAWAN', 'PORT BELAWAN'),
      ('EOP REFINERY TJ.MORAWA', 'PORT BELAWAN'),
      ('EOP GENERAL TJ. MORAWA', 'PORT BELAWAN'),
      ('TPG PALM & LAURIC TJ.LANGSAT', 'PORT PASIR GUDANG'),
      ('GLM REFINERY PORT KLANG', 'PORT KLANG')
    ) AS v(s_name, p_name)
  LOOP
    sap_name := r.s_name;
    port_name := r.p_name;
    SELECT mp.id INTO pid FROM master_loading_ports mp
      WHERE UPPER(BTRIM(mp.port)) = r.p_name
      ORDER BY COALESCE(mp.dhm_is_deleted, false), mp.port
      LIMIT 1;
    IF pid IS NULL THEN
      status := 'port missing in Master Port';
      RETURN NEXT;
      CONTINUE;
    END IF;
    SELECT mp2.port INTO existing_port
      FROM master_port_sap_names n JOIN master_loading_ports mp2 ON mp2.id = n.port_id
      WHERE klip_port_identity(n.sap_name) = klip_port_identity(r.s_name);
    IF existing_port IS NOT NULL THEN
      status := CASE WHEN UPPER(BTRIM(existing_port)) = r.p_name THEN 'already there' ELSE 'kept: already ' || existing_port END;
      RETURN NEXT;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM master_loading_ports mp3 WHERE klip_port_identity(mp3.port) = klip_port_identity(r.s_name)) THEN
      status := 'skipped: the text is itself a Master Port';
      RETURN NEXT;
      CONTINUE;
    END IF;
    INSERT INTO master_port_sap_names (port_id, sap_name) VALUES (pid, r.s_name);
    status := 'seeded';
    RETURN NEXT;
  END LOOP;
END;
$fn$;

DO $$
DECLARE
  seeded integer;
BEGIN
  SELECT count(*) INTO seeded FROM klip_seed_master_port_sap_names() WHERE status = 'seeded';
  RAISE NOTICE 'master_port_sap_names: % seeded from the Port sheet', seeded;
END $$;

SELECT klip_refresh_master_port_ids();
