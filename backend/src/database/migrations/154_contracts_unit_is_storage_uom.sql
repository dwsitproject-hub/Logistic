-- contracts.unit labelled every row 'MT' from a hardcoded literal in the SAP import, while
-- quantity_ordered is normalised to kg by normalizeSapQtyToKg (SAP rows whose Contract Qty UoM
-- is MT are multiplied by 1000 - verified: all 295 such contracts are stored converted, none
-- raw). The label was therefore wrong by a factor of 1000 for anything reading qty + unit.
--
-- Every contract row originates from SAP (18,489 PRESENT + 123 WITHDRAWN, none KLIP-only), so
-- all of them hold kg and can be relabelled. The UI keeps presenting MT by dividing at display
-- time; this column describes storage, not presentation.
UPDATE contracts
SET unit = 'KG', updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(NULLIF(TRIM(unit), ''), '') <> 'KG';
