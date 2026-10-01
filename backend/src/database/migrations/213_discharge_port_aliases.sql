-- Discharge-port names that SAP writes but that are not ports, and the port links lost to migration 207.
--
-- 1. discharge_port_aliases. On docs/CPO 28 Sep 2026.XLSX the Vessel Discharge Port column is a PLANT's
--    name on 681 of 1,485 rows (46%): EUP EDIBLE OIL BONTANG (184), CRC REFINERY TANGERANG (127),
--    PRC PALM & LAURIC BEKASI (78) ... Master Port holds only the PORT-prefixed values (migrations 196/197), so
--    those shipments matched no port and the JPS sweep held every one of them: "discharge port has no DHM code
--    on Master Port". The 31 names are NOT added to Master Port - they are plants, and a sync would create them
--    as ports in DataHub. They go here instead, each with the Site of that plant on the Internal Company sheet,
--    and jps/eligibility.ts resolves the real port from the Site (the port named "PORT <site>").
--    Five Sites differ from the most common Discharge Destination SAP gives the value (1 to 4 rows each):
--    GAN TRADING PLANT 1, PABRIK SIP, EOP GENERAL TJ. MORAWA, PABRIK APM, PLANT EUP TANJUNG PURA.
--
-- 2. Master Port <-> Master Site links. Migration 207's DELETE on master_sites set site_id to NULL on every port
--    whose site it removed (ON DELETE SET NULL); migration 211 put the sites back but only re-linked plants. A port
--    without a Site cannot be pushed to DHM ("Port needs a DHM site"). The pairs are the ones migration 203 chose,
--    applied only to ports with no Site now, so a link set since then is kept.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS discharge_port_aliases (
  alias_name VARCHAR(255) PRIMARY KEY,
  site_id UUID REFERENCES master_sites(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO discharge_port_aliases (alias_name, site_id)
SELECT v.alias_name, s.id
FROM (VALUES
  ('EUP EDIBLE OIL BONTANG', 'BONTANG'),
  ('CRC REFINERY TANGERANG', 'TANGERANG'),
  ('PRC PALM & LAURIC BEKASI', 'BEKASI'),
  ('EUP TRADING PLANT', 'KARAWANG'),
  ('PRC PALM & LAURIC KARAWANG', 'KARAWANG'),
  ('EUP EDIBLE OIL TJ.PURA', 'TANJUNG PURA'),
  ('PRISCOLIN TRADING PLANT', 'KARAWANG'),
  ('EUP EDIBLE OIL BATAM', 'BATAM'),
  ('TSB TRADING PLANT 1', 'BONTANG'),
  ('EOP GENERAL BELAWAN', 'TANJUNG MORAWA'),
  ('THIP TRADING PLANT 2', 'BONTANG'),
  ('CRS TRADING PLANT 1', 'KARAWANG'),
  ('PABRIK WKSM', 'BONTANG'),
  ('CMA TRADING PLANT 1', 'BONTANG'),
  ('SPC PALM & LAURIC LB.GAUNG', 'LUBUK GAUNG'),
  ('TPG PALM & LAURIC TJ.LANGSAT', 'PASIR GUDANG'),
  ('GAN TRADING PLANT 1', 'TANJUNG PURA'),
  ('APM TRADING PLANT 1', 'BONTANG'),
  ('BSU TRADING PLANT 2', 'TANJUNG PURA'),
  ('PTW TRADING PLANT 2', 'BONTANG'),
  ('EOP REFINERY TJ.MORAWA', 'TANJUNG MORAWA'),
  ('PLANT EUP KIJING', 'TANJUNG PURA'),
  ('HSS TRADING PLANT 1', 'BONTANG'),
  ('PABRIK SIP', 'TRADING TRANSIT HO'),
  ('EOP GENERAL TJ. MORAWA', 'TANJUNG MORAWA'),
  ('EOP TRADING PLANT', 'BONTANG'),
  ('WKSM TRADING PLANT 1', 'BONTANG'),
  ('ACP TRADING PLANT 1', 'BONTANG'),
  ('PMC BIOENERGY LB.GAUNG', 'LUBUK GAUNG'),
  ('PLANT EUP TANJUNG PURA', 'TANJUNG PURA'),
  ('PABRIK APM', 'BONTANG')
) AS v(alias_name, site_name)
LEFT JOIN master_sites s ON upper(trim(s.site_name)) = v.site_name
ON CONFLICT (alias_name) DO NOTHING;

UPDATE master_loading_ports AS port_row
SET site_id = site.id
FROM (
  VALUES
    ('PORT ASIKE', 'BONTANG'),
    ('PORT BATAM', 'BATAM'),
    ('PORT BELANG BELANG', 'BONTANG'),
    ('PORT BELINYU', 'KARAWANG'),
    ('PORT BONE MANJING', 'BONTANG'),
    ('PORT BONTANG', 'BONTANG'),
    ('PORT BUDONG BUDONG', 'BONTANG'),
    ('PORT BULUNGAN', 'BONTANG'),
    ('PORT BUNGKUTOKO', 'BONTANG'),
    ('PORT DUMAI', 'RIAU'),
    ('PORT HUK SUNGAI LILIN', 'KARAWANG'),
    ('PORT KENDAWANGAN', 'KARAWANG'),
    ('PORT KETAPANG', 'TANGERANG'),
    ('PORT KUBU', 'BATAM'),
    ('PORT KUMAI', 'BEKASI'),
    ('PORT KUMALINGON, LEOK', 'BONTANG'),
    ('PORT LABANAN', 'BONTANG'),
    ('PORT LEMPAKE', 'BONTANG'),
    ('PORT LOKTUAN', 'BONTANG'),
    ('PORT MALOY', 'BONTANG'),
    ('PORT MAMUJU', 'BONTANG'),
    ('PORT MANUBAR', 'BONTANG'),
    ('PORT MARABAHAN', 'BONTANG'),
    ('PORT MARUNDA CENTRAL (MCT)', 'KARAWANG'),
    ('PORT MERAUKE', 'BONTANG'),
    ('PORT MUARA KAMAN', 'BONTANG'),
    ('PORT NUNUKAN', 'BONTANG'),
    ('PORT PANGKAL BALAM', 'KARAWANG'),
    ('PORT PELINDO KIJING', 'KARAWANG'),
    ('PORT PENGANDAN', 'BONTANG'),
    ('PORT PONDONG', 'BONTANG'),
    ('PORT SADAI', 'KARAWANG'),
    ('PORT SANGKULIRANG', 'BONTANG'),
    ('PORT SEBAKIS', 'BONTANG'),
    ('PORT SEBULU', 'BONTANG'),
    ('PORT SUNGAI GUNTUNG', 'BATAM'),
    ('PORT TALANG DUKU', 'KARAWANG'),
    ('PORT TANJUNG API-API', 'KARAWANG'),
    ('PORT TANJUNG BATU - BERAU', 'BONTANG'),
    ('PORT TANJUNG PRIOK', 'TANGERANG'),
    ('PORT TAYAN', 'BATAM')
) AS pair(port_name, site_name)
JOIN master_sites AS site ON upper(trim(site.site_name)) = upper(trim(pair.site_name))
WHERE port_row.site_id IS NULL
  AND upper(trim(port_row.port)) = upper(trim(pair.port_name));
