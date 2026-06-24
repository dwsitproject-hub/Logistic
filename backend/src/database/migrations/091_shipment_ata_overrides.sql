-- Non-destructive extension: SAP ATA stays on shipments / vessel_loading_ports; manual KLIP overrides here.

CREATE TABLE IF NOT EXISTS shipment_ata_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL UNIQUE REFERENCES shipments(id) ON DELETE CASCADE,
  ata_arrival DATE,
  ata_berthed DATE,
  ata_loading_start DATE,
  ata_loading_complete DATE,
  ata_sailed DATE,
  ata_discharge_arrival DATE,
  ata_discharge_berthed DATE,
  ata_discharge_start DATE,
  ata_discharge_complete DATE,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shipment_ata_overrides_shipment
  ON shipment_ata_overrides (shipment_id);
