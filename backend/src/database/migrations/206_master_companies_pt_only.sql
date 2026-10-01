-- Replace Master Company (Internal) with legal names from
-- docs/Master Data - CPO 28 Sep 2026.xlsx, sheet Internal Company.
-- Only a Company Name that starts with PT is kept. One row per Company Code.
-- A longer variant such as "PT KPBN (NOT USED)" is dropped when a shorter PT name exists.
-- Site links are only names that already exist on Master Site.

ALTER TABLE IF EXISTS master_plants DROP CONSTRAINT IF EXISTS master_plants_company_id_fkey;

DELETE FROM master_company_sites;
DELETE FROM master_companies;

SELECT setval('master_company_klip_code_seq', 1, false);

CREATE TEMP TABLE seed_internal_companies (
  company_code TEXT,
  company_name TEXT,
  sites TEXT[]
) ON COMMIT DROP;

INSERT INTO seed_internal_companies (company_code, company_name, sites) VALUES
('AS', 'PT. ANUGERAH SUKSES INVESTAMA', ARRAY[]::text[]),
('BM', 'PT. BIOENERGI SEMESTA MAS', ARRAY[]::text[]),
('BN', 'PT KPBN', ARRAY['PROBOLINGGO']::text[]),
('CD', 'PT. CISADANE RAYA CHEMICALS', ARRAY['TANGERANG']::text[]),
('CS', 'PT. CITRA INDAH SENTOSA', ARRAY[]::text[]),
('EO', 'PT. ENERGI OLEO PERSADA', ARRAY['BONTANG', 'TANJUNG MORAWA']::text[]),
('EU', 'PT ENERGI UNGGUL PERSADA', ARRAY['BATAM', 'BONTANG', 'KARAWANG', 'KUMAI', 'LUBUK GAUNG', 'PALEMBANG', 'TANJUNG PURA']::text[]),
('JP', 'PT. JATI PERKASA NUSANTARA', ARRAY['GRESIK', 'SIDOARJO', 'TANGERANG']::text[]),
('MG', 'PT. MAKSIMA PERKASA ENERGI', ARRAY[]::text[]),
('PE', 'PT. PRAKARSA PALMA ENERGI INTERNUSA', ARRAY[]::text[]),
('RB', 'PT RIAU SEMESTA BIOMASSA', ARRAY['RIAU', 'TANJUNG BUTON']::text[]),
('SB', 'PT SEMESTA BUANA', ARRAY[]::text[]),
('SD', 'PT. SINERGI PANGAN INDONESIA', ARRAY[]::text[]),
('SS', 'PT. SATU SEJAHTERA INVESTAMA', ARRAY[]::text[]),
('UI', 'PT. AGRO HILIR ULTIMA INVESTAMA', ARRAY[]::text[]);

INSERT INTO master_companies (company_code, company_name)
SELECT company_code, company_name
FROM seed_internal_companies
ORDER BY company_code;

INSERT INTO master_company_sites (company_id, site_id)
SELECT company.id, site.id
FROM seed_internal_companies seed
JOIN master_companies company ON upper(trim(company.company_code)) = upper(trim(seed.company_code))
JOIN LATERAL unnest(seed.sites) AS site_name(site_name) ON true
JOIN master_sites site ON upper(trim(site.site_name)) = upper(trim(site_name.site_name))
ON CONFLICT DO NOTHING;
