DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_plants_company_name_plant_code_unique'
  ) THEN
    ALTER TABLE master_plants
      ADD CONSTRAINT master_plants_company_name_plant_code_unique UNIQUE (company_name, plant_code);
  END IF;
END$$;

