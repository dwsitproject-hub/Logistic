-- Master Company (Internal), one row per Company Code on
-- docs/Master Data - CPO 28 Sep 2026.xlsx, sheet Internal Company.
-- When one code has several Company Name values, a PT legal name is kept,
-- otherwise a Head Office / General HO name, otherwise the most common name.
-- Site links only include names that already exist on Master Site.
-- A leftover table from the rolled-back DHM split has company_name/country and no
-- company_code, and master_plants.company_id points at it. Replace that shape.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'master_companies'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'master_companies' AND column_name = 'company_code'
  ) THEN
    ALTER TABLE IF EXISTS master_plants DROP CONSTRAINT IF EXISTS master_plants_company_id_fkey;
    DROP TABLE master_companies CASCADE;
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS master_company_klip_code_seq;

CREATE TABLE IF NOT EXISTS master_companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code_klip VARCHAR(20) NOT NULL DEFAULT ('KCMP-' || lpad(nextval('master_company_klip_code_seq')::text, 4, '0')),
  code_dhm VARCHAR(40),
  company_code VARCHAR(50) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  dhm_id UUID,
  dhm_version INT,
  dhm_updated_at TIMESTAMPTZ,
  dhm_is_deleted BOOLEAN NOT NULL DEFAULT false,
  dhm_payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_companies_code_klip ON master_companies (code_klip);
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_companies_sap_code ON master_companies ((upper(trim(company_code))));
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_companies_code_dhm ON master_companies (code_dhm) WHERE code_dhm IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_companies_dhm_id ON master_companies (dhm_id) WHERE dhm_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS master_company_sites (
  company_id UUID NOT NULL REFERENCES master_companies(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES master_sites(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, site_id)
);

CREATE TEMP TABLE seed_internal_companies (
  company_code TEXT,
  company_name TEXT,
  sites TEXT[]
) ON COMMIT DROP;

INSERT INTO seed_internal_companies (company_code, company_name, sites) VALUES
('AC', 'AC', ARRAY['BONTANG']::text[]),
('AM', 'AM', ARRAY['BONTANG']::text[]),
('AS', 'PT. ANUGERAH SUKSES INVESTAMA', ARRAY[]::text[]),
('BM', 'PT. BIOENERGI SEMESTA MAS', ARRAY[]::text[]),
('BN', 'PT KPBN', ARRAY['PROBOLINGGO']::text[]),
('BU', 'BU', ARRAY['TANJUNG PURA']::text[]),
('CD', 'PT. CISADANE RAYA CHEMICALS', ARRAY['TANGERANG']::text[]),
('CM', 'CM', ARRAY['BONTANG']::text[]),
('CR', 'CR', ARRAY['KARAWANG', 'TANJUNG PURA']::text[]),
('CS', 'PT. CITRA INDAH SENTOSA', ARRAY[]::text[]),
('EO', 'PT. ENERGI OLEO PERSADA', ARRAY['BONTANG', 'TANJUNG MORAWA']::text[]),
('EU', 'PT ENERGI UNGGUL PERSADA', ARRAY['BATAM', 'BONTANG', 'KARAWANG', 'KUMAI', 'LUBUK GAUNG', 'PALEMBANG', 'TANJUNG PURA']::text[]),
('GM', 'GLM HEAD OFFICE MALAYSIA', ARRAY['SELANGOR']::text[]),
('GN', 'GN', ARRAY['TANJUNG PURA']::text[]),
('HS', 'HS', ARRAY['BONTANG']::text[]),
('JJ', 'JJ', ARRAY['LUBUK GAUNG']::text[]),
('JP', 'PT. JATI PERKASA NUSANTARA', ARRAY['GRESIK', 'SIDOARJO', 'TANGERANG']::text[]),
('KU', 'KU', ARRAY['LUBUK GAUNG']::text[]),
('LM', 'LM', ARRAY[]::text[]),
('MG', 'PT. MAKSIMA PERKASA ENERGI', ARRAY[]::text[]),
('MM', 'MM', ARRAY[]::text[]),
('ND', 'SAGSGENERAL HO JAKARTA', ARRAY[]::text[]),
('PE', 'PT. PRAKARSA PALMA ENERGI INTERNUSA', ARRAY[]::text[]),
('PM', 'PMC GENERAL HO JAKARTA', ARRAY['LUBUK GAUNG']::text[]),
('PN', 'PN', ARRAY['BONTANG']::text[]),
('PS', 'PRC GENERAL HO JAKARTA', ARRAY['BEKASI', 'KARAWANG']::text[]),
('PT', 'PT', ARRAY['BONTANG', 'TANJUNG PURA']::text[]),
('RB', 'PT RIAU SEMESTA BIOMASSA', ARRAY['RIAU', 'TANJUNG BUTON']::text[]),
('RI', 'RFI GENERAL HO JAKARTA', ARRAY['BEKASI']::text[]),
('SA', 'SA', ARRAY['BONTANG', 'TANJUNG PURA']::text[]),
('SB', 'PT SEMESTA BUANA', ARRAY[]::text[]),
('SC', 'SPC GENERAL HO JAKARTA', ARRAY['LUBUK GAUNG']::text[]),
('SD', 'PT. SINERGI PANGAN INDONESIA', ARRAY[]::text[]),
('SI', 'SI', ARRAY['TRADING TRANSIT HO']::text[]),
('SS', 'PT. SATU SEJAHTERA INVESTAMA', ARRAY[]::text[]),
('TH', 'TH', ARRAY['BONTANG']::text[]),
('TP', 'TPG GENERAL HO MALAYSIA', ARRAY['PASIR GUDANG']::text[]),
('TS', 'TS', ARRAY['BONTANG', 'TANJUNG PURA']::text[]),
('UI', 'PT. AGRO HILIR ULTIMA INVESTAMA', ARRAY[]::text[]),
('WS', 'WS', ARRAY['BONTANG']::text[]),
('WW', 'WW', ARRAY['BONTANG', 'TANJUNG PURA']::text[]);

INSERT INTO master_companies (company_code, company_name)
SELECT company_code, company_name
FROM seed_internal_companies
ON CONFLICT ((upper(trim(company_code)))) DO NOTHING;

INSERT INTO master_company_sites (company_id, site_id)
SELECT company.id, site.id
FROM seed_internal_companies seed
JOIN master_companies company ON upper(trim(company.company_code)) = upper(trim(seed.company_code))
JOIN LATERAL unnest(seed.sites) AS site_name(site_name) ON true
JOIN master_sites site ON upper(trim(site.site_name)) = upper(trim(site_name.site_name))
ON CONFLICT DO NOTHING;
