-- PO-primary identity: dedupe contracts by PO, scope shipment_id uniqueness per contract.

-- 1) Merge duplicate contracts that share the same PO (keep newest Open / updated).
DO $$
DECLARE
  dup RECORD;
  survivor_id uuid;
  other_id uuid;
BEGIN
  FOR dup IN
    SELECT TRIM(po_number::text) AS po_norm, array_agg(id ORDER BY
      CASE WHEN LOWER(COALESCE(status::text, '')) IN ('open', 'active') THEN 0 ELSE 1 END,
      updated_at DESC NULLS LAST,
      created_at DESC NULLS LAST
    ) AS ids
    FROM contracts
    WHERE NULLIF(TRIM(po_number::text), '') IS NOT NULL
    GROUP BY TRIM(po_number::text)
    HAVING COUNT(*) > 1
  LOOP
    survivor_id := dup.ids[1];
    FOR i IN 2..array_length(dup.ids, 1) LOOP
      other_id := dup.ids[i];
      UPDATE shipments SET contract_id = survivor_id WHERE contract_id = other_id;
      UPDATE trucking_operations SET contract_id = survivor_id WHERE contract_id = other_id;
      UPDATE payments SET contract_id = survivor_id WHERE contract_id = other_id;
      UPDATE documents SET contract_id = survivor_id WHERE contract_id = other_id;
      UPDATE settlement_invoice_summaries SET contract_id = survivor_id WHERE contract_id = other_id;
      INSERT INTO contract_stos (
        contract_id, sto_number, sto_quantity, sto_type, sto_item, sto_classification, plant_code
      )
      SELECT survivor_id, sto_number, sto_quantity, sto_type, sto_item, sto_classification, plant_code
      FROM contract_stos
      WHERE contract_id = other_id
      ON CONFLICT (contract_id, sto_number) DO UPDATE SET
        sto_quantity = COALESCE(EXCLUDED.sto_quantity, contract_stos.sto_quantity),
        sto_type = COALESCE(EXCLUDED.sto_type, contract_stos.sto_type),
        sto_item = COALESCE(EXCLUDED.sto_item, contract_stos.sto_item),
        sto_classification = COALESCE(EXCLUDED.sto_classification, contract_stos.sto_classification),
        plant_code = COALESCE(EXCLUDED.plant_code, contract_stos.plant_code),
        updated_at = CURRENT_TIMESTAMP;
      DELETE FROM contract_stos WHERE contract_id = other_id;
      DELETE FROM contracts WHERE id = other_id;
    END LOOP;
  END LOOP;
END $$;

-- 2) Dedupe sap_processed_data by PO+STO (keep latest row).
DELETE FROM sap_processed_data spd
WHERE spd.id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY TRIM(COALESCE(po_number::text, '')),
                     COALESCE(NULLIF(TRIM(COALESCE(sto_number::text, '')), ''), '')
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      ) AS rn
    FROM sap_processed_data
    WHERE NULLIF(TRIM(COALESCE(po_number::text, '')), '') IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- 3) Shipments: allow same STO/shipment_id on different contracts (different POs).
-- Cancel duplicate active rows within the same contract+shipment_id (keep oldest).
UPDATE shipments s
SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
WHERE s.id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY contract_id, shipment_id
        ORDER BY created_at ASC
      ) AS rn
    FROM shipments
    WHERE COALESCE(status, '') <> 'CANCELLED'
  ) ranked
  WHERE rn > 1
);

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_shipment_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS shipments_contract_id_shipment_id_uidx
  ON shipments (contract_id, shipment_id);

-- 4) One active contract row per PO.
CREATE UNIQUE INDEX IF NOT EXISTS contracts_po_number_uidx
  ON contracts (TRIM(po_number))
  WHERE NULLIF(TRIM(po_number::text), '') IS NOT NULL;

-- 5) Fast lookup for PO+STO processed rows.
CREATE UNIQUE INDEX IF NOT EXISTS sap_processed_po_sto_uidx
  ON sap_processed_data (
    TRIM(po_number),
    COALESCE(NULLIF(TRIM(COALESCE(sto_number::text, '')), ''), '')
  )
  WHERE NULLIF(TRIM(COALESCE(po_number::text, '')), '') IS NOT NULL;
