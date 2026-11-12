-- Product materials: the SAP material is the smallest unit of a commodity, and the key of the mapping KLIP x DHM x JPS (Ryan, 2026-11-12).
--
-- KLIP's Master Product is the broad product name (CPO, POME, SHELL PALM). SAP sends the material of every PO line (migration 255 stores it on contracts), and one product has several
-- of them: CPO has FFA 3.5-5, RSPO MB and FFA > 5 (42 material codes for ~25 products on production). DHM keeps one `commodity` per material_code (unique; the same short_name is
-- allowed), each with its own DataHub code (CMD-...), and JPS takes that code as cargo_hub_code. products.material_code holds ONE code per product and products.product_name is unique
-- and referenced everywhere, so the material gets a table of its own, under the product.
--
--   material_code            SAP's code, unique ignoring case and spaces.
--   material_description     SAP's text for it; the DHM commodity's long_name.
--   product_id               the broad Master Product it belongs to (name match through the product alias, POME = WASTE OIL (POME)); NULL when no Master Product carries that name
--                            (blank product on the contract, a label with no row). product_link_source 'USER' = a person set it: the import never changes it again.
--   product_label            the product label of the contract the import last saw with this material (informational).
--   code_dhm / dhm_*         the DHM commodity of THIS material, the replica columns products carries (migration 194). Filled by the DHM sync, not by the SAP import.
--
-- Filled by the SAP import after every run (utils/productMaterials.ts) and once here from the contracts that already carry a material.

CREATE TABLE IF NOT EXISTS product_materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  material_code VARCHAR(40) NOT NULL,
  material_description VARCHAR(255),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_label VARCHAR(255),
  product_link_source VARCHAR(10) NOT NULL DEFAULT 'AUTO' CHECK (product_link_source IN ('AUTO', 'USER')),
  code_dhm VARCHAR(50),
  dhm_id UUID,
  dhm_version INT,
  dhm_updated_at TIMESTAMPTZ,
  dhm_is_deleted BOOLEAN NOT NULL DEFAULT false,
  dhm_payload JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_materials_material_code
  ON product_materials (upper(trim(material_code)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_materials_code_dhm
  ON product_materials (code_dhm) WHERE code_dhm IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_materials_dhm_id
  ON product_materials (dhm_id) WHERE dhm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_materials_product_id
  ON product_materials (product_id);

-- One-off fill from the contracts that already carry a material. Same statement as SYNC_PRODUCT_MATERIALS_SQL (utils/productMaterials.ts); the alias CASE mirrors PRODUCT_ALIASES.
WITH seen AS (
  SELECT DISTINCT ON (UPPER(TRIM(c.material_code)))
         TRIM(c.material_code) AS material_code,
         NULLIF(TRIM(c.material_description), '') AS material_description,
         NULLIF(TRIM(c.product), '') AS product_label
    FROM contracts c
   WHERE NULLIF(TRIM(c.material_code), '') IS NOT NULL
   ORDER BY UPPER(TRIM(c.material_code)), c.updated_at DESC NULLS LAST
)
INSERT INTO product_materials (material_code, material_description, product_label, product_id)
SELECT s.material_code, s.material_description, s.product_label,
       (SELECT p.id
          FROM products p
         WHERE UPPER(TRIM(COALESCE(CASE UPPER(TRIM(p.product_name)) WHEN 'POME' THEN 'POME' WHEN 'WASTE OIL (POME' THEN 'POME' WHEN 'WASTE OIL (POME)' THEN 'POME' END, p.product_name)))
             = UPPER(TRIM(COALESCE(CASE UPPER(TRIM(s.product_label)) WHEN 'POME' THEN 'POME' WHEN 'WASTE OIL (POME' THEN 'POME' WHEN 'WASTE OIL (POME)' THEN 'POME' END, s.product_label)))
         ORDER BY p.created_at
         LIMIT 1)
  FROM seen s
ON CONFLICT (upper(trim(material_code))) DO NOTHING;
