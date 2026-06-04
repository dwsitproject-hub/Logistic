-- Add operation_id column to shipments table
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS operation_id VARCHAR(100);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_shipments_operation_id ON shipments(operation_id);

