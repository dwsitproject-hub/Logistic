import { sqlCanonicalProductName } from './productAlias';

/**
 * Product materials: the SAP material is the smallest unit of a commodity and the key of the mapping KLIP x DHM x JPS (table product_materials, migration 265).
 *
 * The SAP import stores each PO line's material on its contract (contracts.material_code / material_description, migration 255). This keeps product_materials in step with it, once per
 * import: a material that is new gets a row; a known one keeps its row and takes the newest description / label. The link to the broad Master Product (product_id) is made by name through
 * the product alias (POME = WASTE OIL (POME)) and only while it is empty: a person's choice (product_link_source = 'USER') and an earlier link are never changed by the import.
 *
 * What it never touches: code_dhm and the dhm_* columns. They belong to the DHM sync (the DHM commodity of THIS material).
 *
 * Set-based on purpose, like fillSapFigures: the row-by-row import cannot know every material it will see.
 */
export const SYNC_PRODUCT_MATERIALS_SQL = `
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
           WHERE UPPER(TRIM(${sqlCanonicalProductName('p.product_name')})) = UPPER(TRIM(${sqlCanonicalProductName('s.product_label')}))
           ORDER BY p.created_at
           LIMIT 1)
    FROM seen s
  ON CONFLICT (upper(trim(material_code))) DO UPDATE SET
    material_description = COALESCE(EXCLUDED.material_description, product_materials.material_description),
    product_label = COALESCE(EXCLUDED.product_label, product_materials.product_label),
    product_id = CASE
      WHEN product_materials.product_link_source = 'USER' THEN product_materials.product_id
      ELSE COALESCE(product_materials.product_id, EXCLUDED.product_id)
    END,
    last_seen_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE product_materials.material_description IS DISTINCT FROM COALESCE(EXCLUDED.material_description, product_materials.material_description)
     OR product_materials.product_label IS DISTINCT FROM COALESCE(EXCLUDED.product_label, product_materials.product_label)
     OR (product_materials.product_link_source <> 'USER' AND product_materials.product_id IS NULL AND EXCLUDED.product_id IS NOT NULL)
     OR product_materials.last_seen_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'`;
