-- Master Site for the port's site. One row per Site name on
-- docs/Master Data - CPO 28 Sep 2026.xlsx, sheet Internal Company.
-- City and postal prefer the row whose city matches the site name,
-- otherwise the most common filled city for that site.

CREATE SEQUENCE IF NOT EXISTS master_site_klip_code_seq;

CREATE TABLE IF NOT EXISTS master_sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code_klip VARCHAR(20) NOT NULL DEFAULT ('KSIT-' || lpad(nextval('master_site_klip_code_seq')::text, 4, '0')),
  site_name VARCHAR(255) NOT NULL,
  city VARCHAR(255),
  postal_code VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_sites_code_klip ON master_sites (code_klip);
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_sites_name ON master_sites (upper(trim(site_name)));

INSERT INTO master_sites (site_name, city, postal_code)
VALUES
  ('BATAM', 'BATAM', '29444'),
  ('BEKASI', 'BEKASI', '17131'),
  ('BONTANG', 'BONTANG', '75325'),
  ('GRESIK', 'GRESIK', '61119'),
  ('KARAWANG', 'KARAWANG', '41361'),
  ('KUMAI', 'KUMAI', '74181'),
  ('LUBUK GAUNG', 'DUMAI', '28826'),
  ('PALEMBANG', 'PALEMBANG', '30961'),
  ('PASIR GUDANG', 'JOHOR BAHRU MALAYSIA', '81700'),
  ('PROBOLINGGO', 'DKI JAKARTA', '10330'),
  ('RIAU', 'DKI JAKARTA', '10350'),
  ('SELANGOR', 'PORT KLANG FREE ZONE MALAYSIA', '42920'),
  ('SIDOARJO', 'SIDOARJO', NULL),
  ('TANGERANG', 'TANGERANG', '15115'),
  ('TANJUNG BUTON', 'PEKAN BARU', '28662'),
  ('TANJUNG MORAWA', 'TANJUNG MORAWA', '20362'),
  ('TANJUNG PURA', 'TANJUNG PURA', '78371'),
  ('TRADING TRANSIT HO', NULL, NULL)
ON CONFLICT ((upper(trim(site_name)))) DO NOTHING;
