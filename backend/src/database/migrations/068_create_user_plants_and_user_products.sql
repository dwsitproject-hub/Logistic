-- User ↔ Master Plant and User ↔ Product many-to-many associations.

CREATE TABLE IF NOT EXISTS user_plants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  master_plant_id UUID NOT NULL REFERENCES master_plants(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, master_plant_id)
);

CREATE TABLE IF NOT EXISTS user_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_user_plants_user_id ON user_plants(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plants_master_plant_id ON user_plants(master_plant_id);
CREATE INDEX IF NOT EXISTS idx_user_products_user_id ON user_products(user_id);
CREATE INDEX IF NOT EXISTS idx_user_products_product_id ON user_products(product_id);

-- Backfill from legacy single plant text when it matches a master plant name.
INSERT INTO user_plants (user_id, master_plant_id)
SELECT u.id, mp.id
FROM users u
JOIN master_plants mp ON TRIM(LOWER(mp.plant_name)) = TRIM(LOWER(u.plant))
WHERE u.plant IS NOT NULL AND TRIM(u.plant) <> ''
ON CONFLICT (user_id, master_plant_id) DO NOTHING;
