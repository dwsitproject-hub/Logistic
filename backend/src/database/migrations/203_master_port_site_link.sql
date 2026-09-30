-- Link each master port to a Master Site.
-- Initial pairs come from CPO 28 Sep 2026: the most frequent Discharge Destination
-- that already exists as a site, matched on Vessel Loading Port or Vessel Discharge Port.
-- PORT BONE MANJING has no exact port name in that file; it is paired from PORT OF BONEMANJING.

ALTER TABLE master_loading_ports
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES master_sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_master_loading_ports_site_id
  ON master_loading_ports (site_id);

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
) AS mapped(port_name, site_name)
JOIN master_sites AS site
  ON upper(trim(site.site_name)) = upper(trim(mapped.site_name))
WHERE upper(trim(port_row.port)) = upper(trim(mapped.port_name))
  AND port_row.site_id IS NULL;

UPDATE master_loading_ports AS port_row
SET dhm_site_code = site.code_dhm
FROM master_sites AS site
WHERE site.id = port_row.site_id
  AND NULLIF(trim(site.code_dhm), '') IS NOT NULL
  AND NULLIF(trim(port_row.dhm_site_code), '') IS NULL;
