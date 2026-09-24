-- Correct SFAL/SFBD only on the Oil Loss rows captured on 2026-09-23.
-- A kilogram figure was typed into the MT box, so the stored kg is about 1000× too large.
-- STO 1006018955 (SFAL 11,848 MT) is already in MT scale and is not in this list.
-- A column is divided only while it still displays above 50,000 MT, so a second
-- run does not divide a figure that was already corrected. Anything still off
-- can be edited in View Shipment.

UPDATE shipments s
SET
  sfal_qty = CASE
    WHEN s.sfal_qty > 50000000 THEN s.sfal_qty / 1000
    ELSE s.sfal_qty
  END,
  sfbd_qty = CASE
    WHEN s.sfbd_qty > 50000000 THEN s.sfbd_qty / 1000
    ELSE s.sfbd_qty
  END,
  updated_at = CURRENT_TIMESTAMP
FROM contracts c
WHERE s.contract_id = c.id
  AND (
    TRIM(COALESCE(c.sto_number::text, '')) IN (
      '1011601164',
      '1006018268',
      '1006017886',
      '1006018149',
      '1006018479',
      '1006018513',
      '1006016408',
      '1006020018',
      '1006016370',
      '1006019664',
      '1006019368'
    )
    OR TRIM(COALESCE(s.operation_id, '')) IN (
      'OP-1010042322-21703592'
    )
    OR TRIM(COALESCE(s.shipment_id::text, '')) IN (
      '1011601164',
      '1006018268',
      '1006017886',
      '1006018149',
      '1006018479',
      '1006018513',
      '1006016408',
      '1006020018',
      '1006016370',
      '1006019664',
      '1006019368',
      'OP-1010042322-21703592'
    )
  )
  AND (
    COALESCE(s.sfal_qty, 0) > 50000000
    OR COALESCE(s.sfbd_qty, 0) > 50000000
  );
