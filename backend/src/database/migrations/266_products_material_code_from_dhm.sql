-- Master Product: the material_code DHM already sent, copied into the column (Ryan, 2026-11-12).
--
-- The Master Product table IS the DHM commodity catalog: the DHM sync stores one row per commodity (3,405 on SIT), each with its DataHub code. DHM's commodity carries the SAP material_code
-- (unique there), and the record is kept whole in dhm_payload, but products.material_code (migration 248, 26 Oct) stayed empty on every row: the code that copies it ran only for records the
-- sync pulled AFTER that change, and a sync pulls what changed. 3,404 of 3,405 payloads on SIT hold a material_code; no row had it in the column.
--
-- The column is what the rest of KLIP reads: JPS takes the DHM code of the Master Product whose material_code is the contract's SAP material (cargo_hub_code), KMAPS the same, and the push
-- to DHM refuses a commodity without it ("DHM commodity needs material_code": 3,404 rows SYNC FAILED for that reason alone).
--
-- 1. Copy it from the stored payload where the column is empty. material_code is unique ignoring case and spaces (migration 248), so a code that two payloads share goes to one row only (a live
--    commodity before a deleted one) and a code another row already holds is left alone.
-- 2. Drop the "needs material_code" push states of rows that came FROM DHM (they have its id) and have the code now: there is nothing to push, and the retry job would otherwise send them back
--    to DHM, 25 per pull, for a record DHM already holds.
-- 3. product_materials (a separate table for the same thing, built and then withdrawn on 2026-11-12) goes. It held only what the SAP import and the DHM sync had written to it.

WITH src AS (
  SELECT DISTINCT ON (upper(trim(dhm_payload->>'material_code')))
         id, trim(dhm_payload->>'material_code') AS code
    FROM products
   WHERE NULLIF(trim(material_code), '') IS NULL
     AND NULLIF(trim(dhm_payload->>'material_code'), '') IS NOT NULL
   ORDER BY upper(trim(dhm_payload->>'material_code')), COALESCE(dhm_is_deleted, false), created_at, id
)
UPDATE products p
   SET material_code = src.code
  FROM src
 WHERE p.id = src.id
   AND NOT EXISTS (
     SELECT 1 FROM products o
      WHERE o.id <> p.id AND upper(trim(o.material_code)) = upper(trim(src.code))
   );

DELETE FROM dhm_push_state s
 USING products p
 WHERE s.entity_kind = 'product'
   AND s.entity_id = p.id
   AND s.error ILIKE 'DHM commodity needs material_code%'
   AND p.dhm_id IS NOT NULL
   AND NULLIF(trim(p.material_code), '') IS NOT NULL;

DROP TABLE IF EXISTS product_materials;
