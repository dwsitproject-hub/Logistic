-- Commodity fields KLIP did not store. Product stays the DHM short name.
ALTER TABLE products ADD COLUMN IF NOT EXISTS long_name VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS commodity_type VARCHAR(80);
