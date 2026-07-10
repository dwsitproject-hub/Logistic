-- Optional supplier reference columns (manual entry / future use; not populated by CSV import).
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS prov_code VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS prov_no VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS mill_no VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS mill_code VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ggl VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS update_year INTEGER;
