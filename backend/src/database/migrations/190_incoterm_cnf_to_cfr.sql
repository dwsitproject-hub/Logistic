-- CNF / C&F -> CFR in stored data, to match what import and the manual contract form now write.
--
-- SAP sent contract 1624000075 (6,900 MT CPO, SEA, nothing delivered, past its delivery window) as
-- CNF, an older name for CFR. Every page that scopes by incoterm lists CFR, so the contract was on
-- Contract Performance and on no execution page: not Shipments, not Shipping Performance. The code
-- now canonicalises at the door (utils/incotermAlias.ts); this brings the rows already inside in line.
--
-- Rewritten: the normalised copies KLIP reads.
--   contracts.incoterm
--   sap_processed_data.incoterm and data->'contract'->'incoterm'
--   contract_performance_snapshot.incoterm
-- NOT rewritten: sap_processed_data.data->'raw', which stays exactly what SAP sent.
--
-- sap_processed_data is matched on its flat incoterm column only. Both import writers fill that
-- column from the same parsed value as data->'contract'->'incoterm', and filtering on the JSON would
-- detoast every row in the table to find the handful that match.
--
-- Pipeline summary tables are left to their refresh: they carry incoterm in UNIQUE keys, and renaming
-- CNF to CFR in place could collide with an existing CFR row. They are rebuilt from contracts.
--
-- A SUGGESTED pre-planned group keyed on CNF is superseded rather than relabelled: its partition_key
-- embeds the incoterm, so changing the column alone would leave a row that disagrees with its own
-- key. Superseding is exactly what the next rebuild does, and that rebuild regroups from contracts
-- that now say CFR. ACCEPTED groups are a user's decision and are not touched.
--
-- Idempotent: a second run finds nothing to change.

DO $$
DECLARE
  n_contracts INT;
  n_spd INT;
  n_snapshot INT;
  n_groups INT;
BEGIN
  UPDATE contracts
     SET incoterm = 'CFR'
   WHERE UPPER(TRIM(incoterm)) IN ('CNF', 'C&F');
  GET DIAGNOSTICS n_contracts = ROW_COUNT;

  UPDATE sap_processed_data
     SET incoterm = 'CFR',
         data = CASE
           WHEN UPPER(TRIM(data->'contract'->>'incoterm')) IN ('CNF', 'C&F')
             THEN jsonb_set(data, '{contract,incoterm}', '"CFR"'::jsonb)
           ELSE data
         END
   WHERE UPPER(TRIM(incoterm)) IN ('CNF', 'C&F');
  GET DIAGNOSTICS n_spd = ROW_COUNT;

  UPDATE contract_performance_snapshot
     SET incoterm = 'CFR'
   WHERE UPPER(TRIM(incoterm)) IN ('CNF', 'C&F');
  GET DIAGNOSTICS n_snapshot = ROW_COUNT;

  UPDATE pre_planned_groups
     SET status = 'SUPERSEDED', updated_at = NOW()
   WHERE status = 'SUGGESTED'
     AND UPPER(TRIM(incoterm)) IN ('CNF', 'C&F');
  GET DIAGNOSTICS n_groups = ROW_COUNT;

  RAISE NOTICE 'incoterm CNF -> CFR: contracts=%, sap_processed_data=%, contract_performance_snapshot=%, pre_planned_groups superseded=%',
    n_contracts, n_spd, n_snapshot, n_groups;
END $$;
