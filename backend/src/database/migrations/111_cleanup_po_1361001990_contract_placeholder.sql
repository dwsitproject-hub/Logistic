-- Targeted SIT cleanup for PO 1361001990.
-- The valid business record is contract 1364001990 / STO 1366001060.
-- Merge any PO-prefixed placeholder into the real contract and repair SAP/snapshot quantities.

DO $$
DECLARE
  real_contract_uuid uuid;
  placeholder_uuid uuid;
BEGIN
  SELECT id
    INTO real_contract_uuid
  FROM contracts
  WHERE contract_id = '1364001990'
    AND po_number = '1361001990'
  LIMIT 1;

  IF real_contract_uuid IS NULL THEN
    RAISE NOTICE 'PO 1361001990 cleanup skipped: contract 1364001990 not found';
    RETURN;
  END IF;

  SELECT id
    INTO placeholder_uuid
  FROM contracts
  WHERE contract_id = 'PO-1361001990'
  LIMIT 1;

  IF placeholder_uuid IS NOT NULL AND placeholder_uuid <> real_contract_uuid THEN
    UPDATE shipments
    SET contract_id = real_contract_uuid
    WHERE contract_id = placeholder_uuid;

    UPDATE trucking_operations
    SET contract_id = real_contract_uuid
    WHERE contract_id = placeholder_uuid;

    UPDATE payments
    SET contract_id = real_contract_uuid
    WHERE contract_id = placeholder_uuid;

    UPDATE documents
    SET contract_id = real_contract_uuid
    WHERE contract_id = placeholder_uuid;

    UPDATE settlement_invoice_summaries
    SET contract_id = real_contract_uuid
    WHERE contract_id = placeholder_uuid;

    INSERT INTO contract_stos (
      contract_id,
      sto_number,
      sto_quantity,
      sto_type,
      sto_item,
      sto_classification,
      plant_code
    )
    SELECT
      real_contract_uuid,
      sto_number,
      sto_quantity,
      sto_type,
      sto_item,
      sto_classification,
      plant_code
    FROM contract_stos
    WHERE contract_id = placeholder_uuid
    ON CONFLICT (contract_id, sto_number) DO UPDATE SET
      sto_quantity = COALESCE(EXCLUDED.sto_quantity, contract_stos.sto_quantity),
      sto_type = COALESCE(EXCLUDED.sto_type, contract_stos.sto_type),
      sto_item = COALESCE(EXCLUDED.sto_item, contract_stos.sto_item),
      sto_classification = COALESCE(EXCLUDED.sto_classification, contract_stos.sto_classification),
      plant_code = COALESCE(EXCLUDED.plant_code, contract_stos.plant_code),
      updated_at = CURRENT_TIMESTAMP;

    DELETE FROM contract_stos WHERE contract_id = placeholder_uuid;
    DELETE FROM contracts WHERE id = placeholder_uuid;
  END IF;

  UPDATE sap_processed_data
  SET
    contract_number = '1364001990',
    data = jsonb_set(
      COALESCE(data, '{}'::jsonb),
      '{contract,contract_number}',
      to_jsonb('1364001990'::text),
      true
    ),
    updated_at = CURRENT_TIMESTAMP
  WHERE po_number = '1361001990'
    AND sto_number = '1366001060'
    AND (
      contract_number IS NULL
      OR TRIM(contract_number) = ''
      OR contract_number = 'PO-1361001990'
    );

  DELETE FROM contract_qty_move_snapshot
  WHERE contract_number = 'PO-1361001990';

  INSERT INTO contract_qty_move_snapshot (
    contract_number,
    quantity_delivery_trucking,
    quantity_delivery_vessel,
    quantity_receive,
    quantity_delivery,
    refreshed_at
  )
  VALUES (
    '1364001990',
    150000,
    0,
    149210,
    150000,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (contract_number) DO UPDATE SET
    quantity_delivery_trucking = EXCLUDED.quantity_delivery_trucking,
    quantity_delivery_vessel = EXCLUDED.quantity_delivery_vessel,
    quantity_receive = EXCLUDED.quantity_receive,
    quantity_delivery = EXCLUDED.quantity_delivery,
    refreshed_at = EXCLUDED.refreshed_at;
END
$$;
