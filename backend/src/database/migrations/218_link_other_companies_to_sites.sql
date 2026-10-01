-- Give the eleven companies that are not on the sheet "Internal Company (Final)" their Sites, from the sheet we
-- completed, "Internal Company", of docs/Master Data - CPO 28 Sep 2026.xlsx.
--
-- Migration 217 replaced the three masters with the Final sheet (11 companies). The DHM sync then brought back every
-- organisation that still exists in DHM, and those eleven showed an empty Site column in Master Company (Internal),
-- because the Final sheet has no plant for them. The older sheet does, and it has been completed too:
--   AS, BM, CS, SD, SS, UI   only head-office plants                      -> JAKARTA
--   BN                       head office, and BN10 at PROBOLINGGO         -> JAKARTA, PROBOLINGGO
--   MG                       head office, and plants at TANJUNG PURA      -> JAKARTA, TANJUNG PURA
--   ND                       head office, and plants at MERAUKE           -> JAKARTA, MERAUKE
--   PE                       head office, BONTANG, BAYAH, SALO PALAI      -> JAKARTA, BONTANG, BAYAH, SALO PALAI
--   SB                       head office, SALO PALAI, SINTETE             -> JAKARTA, SALO PALAI, SINTETE
-- The same rule as the Final sheet: a Site a person typed stays, a head-office plant without one is JAKARTA, any
-- other blank takes the Site of its City.
--
-- BAYAH, SALO PALAI, SINTETE and PROBOLINGGO were deleted by 217 (the Final sheet does not use them) and are added
-- again, with the City and postal code they had. An existing Site is left as it is (PROBOLINGGO may already be back
-- from DHM). Master Plant is NOT touched: it keeps the 148 plants of the Final sheet, so these companies show Sites
-- without plants of their own in Master Plant.
--
-- EOP, the duplicate of EO, is left out on purpose. Additive and idempotent; nothing is deleted.

INSERT INTO master_sites (site_name, city, postal_code)
SELECT v.site_name, v.city, v.postal_code
  FROM (VALUES
    ('BAYAH', 'BAYAH', '42393'),
    ('SALO PALAI', 'SALO PALAI', '75382'),
    ('SINTETE', 'KALIMANTAN BARAT', NULL),
    ('PROBOLINGGO', 'DKI JAKARTA', '10330')
  ) AS v(site_name, city, postal_code)
 WHERE NOT EXISTS (SELECT 1 FROM master_sites m WHERE upper(btrim(m.site_name)) = upper(v.site_name));

INSERT INTO master_company_sites (company_id, site_id)
SELECT company.id, site.id
  FROM (VALUES
    ('AS', 'JAKARTA'),
    ('BM', 'JAKARTA'),
    ('CS', 'JAKARTA'),
    ('SD', 'JAKARTA'),
    ('SS', 'JAKARTA'),
    ('UI', 'JAKARTA'),
    ('BN', 'JAKARTA'), ('BN', 'PROBOLINGGO'),
    ('MG', 'JAKARTA'), ('MG', 'TANJUNG PURA'),
    ('ND', 'JAKARTA'), ('ND', 'MERAUKE'),
    ('PE', 'JAKARTA'), ('PE', 'BONTANG'), ('PE', 'BAYAH'), ('PE', 'SALO PALAI'),
    ('SB', 'JAKARTA'), ('SB', 'SALO PALAI'), ('SB', 'SINTETE')
  ) AS pair(company_code, site_name)
  JOIN master_companies company ON upper(btrim(company.company_code)) = upper(pair.company_code)
  JOIN master_sites site ON upper(btrim(site.site_name)) = upper(pair.site_name)
ON CONFLICT DO NOTHING;
