-- Master Product: hs_code and uom, which the DHM commodity catalog carries and KLIP stores (migration 248 said they "already exist on this table").
--
-- They did on SIT, but no migration ever created them, so a database built from the migrations alone (production) has no such columns. Every write that names them fails with
-- `column "hs_code" of relation "products" does not exist`: the DHM commodity pull (applyCommodity, 3,470 records, all refused on 2026-11-16, which is why Master Product held
-- 25 KLIP-made rows and none from DHM) and creating or editing a product (product.controller). Additive and nullable; ADD COLUMN IF NOT EXISTS leaves SIT, which has them, as it is.

ALTER TABLE products ADD COLUMN IF NOT EXISTS hs_code VARCHAR(40);
ALTER TABLE products ADD COLUMN IF NOT EXISTS uom VARCHAR(20);
