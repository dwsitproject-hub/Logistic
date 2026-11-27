/**
 * The file name of a document uploaded on a shipment or a trucking operation, in the format Commercial Documents (COD) gives its own files, so the two apps name documents the same way:
 *
 *   COD       [BUY]_[Code]_[PO number](2).pdf        EOP_Ctr_1001032470.pdf
 *   shipment  [BUY]_[Code]_[STO number](2).pdf       EOP_Ctr_1006020654.pdf   (the shipment id when there is no STO)
 *   trucking  [BUY]_Do_[PO number](2).pdf            EOP_Do_1001032470.pdf
 *
 * [BUY] is the first three letters of the buyer (the supplier when the contract has no buyer), exactly as COD reads it. A second file of the same name in the folder becomes (2),
 * (3)...: COD's own version suffix. Ryan, 2026-11-27.
 */
import { buyerFilenamePrefix, sanitizePoForFilename } from './commercialDocumentsConstants';

/**
 * The code in the name. Contract and Delivery Order are COD's own (Ctr, Do), written the way COD writes its codes (Ba, Bc, Sppb). SI, BL, Loading, Discharge and Others have no COD
 * code, so they get one in the same style. Keyed by the folder kind of the document (utils/fileUpload.ts).
 */
export const SHIPMENT_DOC_FILE_CODES = { contract: 'Ctr', si: 'Si', bl: 'Bl', sld: 'Sld', sdd: 'Sdd', other: 'Oth' } as const;

export type ShipmentDocKind = keyof typeof SHIPMENT_DOC_FILE_CODES;

/** The code of a Delivery Order uploaded on the Trucking page (document_type DO). */
export const TRUCKING_DO_FILE_CODE = 'Do';

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

/** `EOP_Ctr_1006020654`, without the extension. `code` is a SHIPMENT_DOC_FILE_CODES value or TRUCKING_DO_FILE_CODE. */
export function buildShipmentDocumentStem(input: { buyer?: unknown; supplier?: unknown; code: string; reference: string }): string {
  const buyer = String(input.buyer ?? '').trim() || String(input.supplier ?? '').trim();
  return `${buyerFilenamePrefix(buyer)}_${input.code}_${sanitizePoForFilename(input.reference)}`;
}
