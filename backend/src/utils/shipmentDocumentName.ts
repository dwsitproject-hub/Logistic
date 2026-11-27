/**
 * The file name of a Contract / SI / BL uploaded on a shipment, in the format Commercial Documents (COD) gives its own files, so the two apps name documents the same way:
 *
 *   COD       [BUY]_[Code]_[PO number](2).pdf        EOP_Ctr_1001032470.pdf
 *   shipment  [BUY]_[Code]_[STO number](2).pdf       EOP_Ctr_1006020654.pdf
 *
 * [BUY] is the first three letters of the buyer (the supplier when the contract has no buyer), exactly as COD reads it. The reference is the shipment's STO number, and its
 * shipment id when it has none (Ryan, 2026-11-27). A second file of the same name in the folder becomes (2), (3)...: COD's own version suffix.
 */
import { buyerFilenamePrefix, sanitizePoForFilename } from './commercialDocumentsConstants';

/** The code COD uses for the document type, capitalised the way COD writes its own (Ctr, Ba, Bc, Do). SI and BL have no COD code of their own. */
export const SHIPMENT_DOC_FILE_CODES = { ctr: 'Ctr', si: 'Si', bl: 'Bl' } as const;

export type ShipmentDocToken = keyof typeof SHIPMENT_DOC_FILE_CODES;

/**
 * The STO number of the shipment, else its shipment id. `folderSubject` is the STO key the Shipments page and JPS use (shipmentListStoKeyExpr), which ends in the operation id
 * when the shipment has no STO at all, so a subject equal to the operation id means "no STO".
 */
export function shipmentDocumentReference(row: { folder_subject?: unknown; operation_id?: unknown; shipment_id?: unknown }): string {
  const subject = String(row.folder_subject ?? '').trim();
  const operationId = String(row.operation_id ?? '').trim();
  if (subject && subject !== operationId) return subject;
  return String(row.shipment_id ?? '').trim() || operationId;
}

/** `EOP_Ctr_1006020654`, without the extension. */
export function buildShipmentDocumentStem(input: { buyer?: unknown; supplier?: unknown; token: ShipmentDocToken; reference: string }): string {
  const buyer = String(input.buyer ?? '').trim() || String(input.supplier ?? '').trim();
  return `${buyerFilenamePrefix(buyer)}_${SHIPMENT_DOC_FILE_CODES[input.token]}_${sanitizePoForFilename(input.reference)}`;
}
