import { describe, expect, it } from 'vitest';
import { buildShipmentDocumentStem, shipmentDocumentReference, SHIPMENT_DOC_FILE_CODES, TRUCKING_DO_FILE_CODE } from './shipmentDocumentName';

describe('shipmentDocumentName: the COD file-name format for a shipment document', () => {
  it('the reference is the STO number, and the shipment id when the shipment has no STO (its STO key ends in the operation id)', () => {
    expect(shipmentDocumentReference({ folder_subject: '1006020654', operation_id: 'OP-1', shipment_id: 'MNL-1' })).toBe('1006020654');
    expect(shipmentDocumentReference({ folder_subject: 'OP-1', operation_id: 'OP-1', shipment_id: 'MNL-1' })).toBe('MNL-1');
    expect(shipmentDocumentReference({ folder_subject: null, operation_id: 'OP-1', shipment_id: null })).toBe('OP-1');
    expect(shipmentDocumentReference({})).toBe('');
  });

  it('BUY_Code_reference: three letters of the buyer, the supplier when there is no buyer, the COD codes', () => {
    expect(buildShipmentDocumentStem({ buyer: 'EOP Trading', code: SHIPMENT_DOC_FILE_CODES.contract, reference: '1006020654' })).toBe('EOP_Ctr_1006020654');
    expect(buildShipmentDocumentStem({ buyer: '', supplier: 'Mega Sawit', code: SHIPMENT_DOC_FILE_CODES.si, reference: '1006020654' })).toBe('MEG_Si_1006020654');
    expect(buildShipmentDocumentStem({ code: SHIPMENT_DOC_FILE_CODES.bl, reference: 'MNL 1/2' })).toBe('XXX_Bl_MNL_12');
    expect(buildShipmentDocumentStem({ buyer: 'EOP', code: SHIPMENT_DOC_FILE_CODES.contract, reference: '' })).toBe('EOP_Ctr_UNKNOWN');
    expect(buildShipmentDocumentStem({ buyer: 'EOP Trading', code: TRUCKING_DO_FILE_CODE, reference: '1001032470' })).toBe('EOP_Do_1001032470');
    expect(Object.values(SHIPMENT_DOC_FILE_CODES)).toEqual(['Ctr', 'Si', 'Bl', 'Sld', 'Sdd', 'Oth']);
  });
});
