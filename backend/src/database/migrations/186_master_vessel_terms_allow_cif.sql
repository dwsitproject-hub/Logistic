-- Charter type on master vessel also accepts CIF, besides T/C and V/C.
ALTER TABLE master_vessels
  DROP CONSTRAINT IF EXISTS master_vessels_terms_chk;

ALTER TABLE master_vessels
  ADD CONSTRAINT master_vessels_terms_chk
  CHECK (terms IS NULL OR terms IN ('T/C', 'V/C', 'CIF'));
