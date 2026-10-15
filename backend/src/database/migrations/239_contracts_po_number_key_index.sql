-- Contracts: index the B2B-origin lookup "the contract whose PO is this child's Contract Reff PO", as the queries spell it.
--
-- Asked by Ryan on 2026-10-15 (Shipping Performance slow on a cold load). Measured on a migrated copy of the dev database (jit off, as the app
-- runs): the Shipping Performance statement looks up each row's B2B origin with
--
--   SELECT o.contract_id FROM contracts o WHERE NULLIF(TRIM(o.po_number::text), '') = NULLIF(TRIM(<reff po>), '') LIMIT 1
--
-- once per row, and that was 2,214 Seq Scans of contracts. The existing po_number indexes are TRIM(po_number) (contracts_po_number_uidx,
-- partial) and TRIM(po_number::text) (idx_contracts_po_trim_created_desc): the same rows for a non-empty PO, but not the expression the query
-- uses, so the planner cannot use them (migration 179's lesson). The same expression joins B2B parents in shippingPerfContractGrainOs.service.ts
-- and contractGlobalOutstandingSql.ts.
--
-- ACCESS PATH ONLY: which rows match does not change. On the dev copy the statement returned the same 2,215 rows with and without it; with
-- the perf_sto_status join-order fix of the same commit, 25.9 s -> 7.2 s. Build time on the dev copy: 130 ms. No CONCURRENTLY needed inside the
-- migration runner's transaction.

CREATE INDEX IF NOT EXISTS idx_contracts_po_number_key
  ON contracts ((NULLIF(TRIM(po_number::text), '')));
