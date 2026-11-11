-- SFAL / SFBD belong to the SHIPMENT (the STO), not to a PO (Ryan, 2026-11-11).
--
-- Migration 255 kept SAP's figure per PO x STO row (sap_sfal_qty / sap_sfbd_qty) and filled the working figure only on an STO with ONE shipment row, because it was
-- not known whether SAP's figure on a multi-PO STO is each PO's share or the whole voyage repeated. The 11 Nov 2026 file answers it (tested against each STO's total
-- B/L, 191 multi-PO STOs with an SFAL): 176 are SHARES of the voyage (the rows add up to the total B/L, each row is its PO's B/L times one ratio), 6 repeat the WHOLE
-- voyage figure on every PO, 8 are neither. SapDataDistributionService.fillSapFigures now derives ONE figure per STO from those rows (utils/sapFigureFill.ts) and
-- writes it on the STO's primary row, the row the Shipments list opens in Edit Shipment.
--
-- These two columns hold that STO-level SAP figure, on the primary row only (NULL on every other row, and NULL where the rows cannot be told apart). They are the
-- reference the modal shows beside the working figure, and they are rewritten by every import: nothing here is a user's. sap_sfal_qty / sap_sfbd_qty stay as they were,
-- SAP's figure for the PO x STO row.

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sap_sfal_sto_qty NUMERIC;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sap_sfbd_sto_qty NUMERIC;
