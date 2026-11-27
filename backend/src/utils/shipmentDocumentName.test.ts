import { describe, expect, it } from 'vitest';
import { buildShipmentDocumentStem, shipmentDocumentReference } from './shipmentDocumentName';

describe('shipmentDocumentName: the COD file-name format for a shipment document', () => {
  it('the reference is the STO number, and the shipment id when the shipment has no STO (its STO key ends in the operation id)', () => {
    expect(shipmentDocumentReference({ folder_subject: '1006020654', operation_id: 'OP-1', shipment_id: 'MNL-1' })).toBe('1006020654');
    expect(shipmentDocumentReference({ folder_subject: 'OP-1', operation_id: 'OP-1', shipment_id: 'MNL-1' })).toBe('MNL-1');
    expect(shipmentDocumentReference({ folder_subject: null, operation_id: 'OP-1', shipment_id: null })).toBe('OP-1');
    expect(shipmentDocumentReference({})).toBe('');
  });

  it('BUY_Code_reference: three letters of the buyer, the supplier when there is no buyer, the COD codes', () => {
    expect(buildShipmentDocumentStem({ buyer: 'EOP Trading', token: 'ctr', reference: '1006020654' })).toBe('EOP_Ctr_1006020654');
    expect(buildShipmentDocumentStem({ buyer: '', supplier: 'Mega Sawit', token: 'si', reference: '1006020654' })).toBe('MEG_Si_1006020654');
    expect(buildShipmentDocumentStem({ token: 'bl', reference: 'MNL 1/2' })).toBe('XXX_Bl_MNL_12');
    expect(buildShipmentDocumentStem({ buyer: 'EOP', token: 'ctr', reference: '' })).toBe('EOP_Ctr_UNKNOWN');
  });
});
