-- Increase column lengths to accommodate longer codes from Excel uploads

ALTER TABLE master_plants
  ALTER COLUMN plant_code TYPE VARCHAR(150),
  ALTER COLUMN postal_code TYPE VARCHAR(150);

