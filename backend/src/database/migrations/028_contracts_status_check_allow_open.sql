-- Ensure contracts.status allows both SAP-aligned ('Open','Close','Cancelled') and legacy ('ACTIVE','COMPLETED','CANCELLED')
-- so SAP upload and other writers never hit check constraint violations.
-- Idempotent: drop then add (add will replace if we re-run after 027).

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE contracts
  ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('Open','Close','Cancelled','ACTIVE','COMPLETED','CANCELLED'));
