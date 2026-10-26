-- Master Product: the fields DHM's commodity catalog asks for that KLIP did not hold.
--
-- DHM (OpenAPI 1.7, checked 2026-10-26) requires material_code (unique) on `commodity`, besides short_name, long_name and
-- type. material_group is optional there. hs_code and uom already exist on this table and are now sent to DHM too.
--
-- material_code will come from the SAP data import once the SAP team has adjusted the extract (about two weeks after this
-- change). Until then it is empty, and a product without it is not accepted by DHM: the push is noted as failed with
-- "DHM commodity needs material_code" and is retried by the push-retry job once the code is filled in.
--
-- Nullable on purpose. Unique ignoring case and surrounding spaces, but only where a code is set.

ALTER TABLE products ADD COLUMN IF NOT EXISTS material_code VARCHAR(40);
ALTER TABLE products ADD COLUMN IF NOT EXISTS material_group VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_material_code
  ON products (upper(trim(material_code)))
  WHERE material_code IS NOT NULL AND trim(material_code) <> '';
