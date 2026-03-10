-- Create vessel_loading_ports table for detailed vessel loading information
-- This table supports multiple loading ports per shipment

CREATE TABLE IF NOT EXISTS vessel_loading_ports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
    port_name VARCHAR(255) NOT NULL,
    port_sequence INTEGER NOT NULL DEFAULT 1, -- 1, 2, 3, etc.
    
    -- Quantity information
    quantity_at_loading_port DECIMAL(15, 2),
    
    -- ETA/ATA fields
    eta_vessel_arrival TIMESTAMP,
    ata_vessel_arrival TIMESTAMP,
    eta_vessel_berthed TIMESTAMP,
    ata_vessel_berthed TIMESTAMP,
    eta_loading_start TIMESTAMP,
    ata_loading_start TIMESTAMP,
    eta_loading_completed TIMESTAMP,
    ata_loading_completed TIMESTAMP,
    eta_vessel_sailed TIMESTAMP,
    ata_vessel_sailed TIMESTAMP,
    
    -- Calculated fields
    loading_rate DECIMAL(10, 4), -- MT/hour - calculated as (ATA Loading Completed - ATA Loading Start) / Quantity
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_vessel_loading_ports_shipment_id ON vessel_loading_ports(shipment_id);
CREATE INDEX IF NOT EXISTS idx_vessel_loading_ports_port_sequence ON vessel_loading_ports(shipment_id, port_sequence);

-- Add update timestamp trigger
DROP TRIGGER IF EXISTS update_vessel_loading_ports_updated_at ON vessel_loading_ports;
CREATE TRIGGER update_vessel_loading_ports_updated_at BEFORE UPDATE ON vessel_loading_ports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE vessel_loading_ports IS 'Detailed vessel loading port information with ETA/ATA tracking';
COMMENT ON COLUMN vessel_loading_ports.port_sequence IS 'Sequence number for multiple loading ports (1, 2, 3, etc.)';
COMMENT ON COLUMN vessel_loading_ports.loading_rate IS 'Calculated loading rate in MT/hour';
COMMENT ON COLUMN vessel_loading_ports.quantity_at_loading_port IS 'Quantity loaded at this specific port';
