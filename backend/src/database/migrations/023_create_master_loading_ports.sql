CREATE TABLE IF NOT EXISTS master_loading_ports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  region VARCHAR(100),
  port VARCHAR(255) NOT NULL,
  coordinate VARCHAR(255),
  masuk_alur VARCHAR(10),
  lebar_alur VARCHAR(100),
  jumlah_jembatan INT,
  jenis_port VARCHAR(50),
  pemilik_port VARCHAR(255),
  antri_muat_hari INT,
  jumlah_demaraga INT,
  panjang_demaraga VARCHAR(100),
  draft VARCHAR(100),
  dwt VARCHAR(100),
  siklus_pasang VARCHAR(100),
  loading_method VARCHAR(255),
  loading_rate_mt_per_hour DECIMAL(15,2),
  shipper VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_master_loading_ports_port
  ON master_loading_ports (port);

