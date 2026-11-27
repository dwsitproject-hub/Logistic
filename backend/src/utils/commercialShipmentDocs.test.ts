import { describe, expect, it } from 'vitest';
import { COMMERCIAL_SHIPMENT_DOCS_SQL, groupShipmentDocs, shipmentDocsAsHistory, type ShipmentDocRow } from './commercialShipmentDocs';

const row = (o: Partial<ShipmentDocRow>): ShipmentDocRow => ({
  id: 'd1',
  document_type: 'BL',
  file_name: 'BL.pdf',
  file_size: '1000',
  mime_type: 'application/pdf',
  upload_date: '2026-11-20T03:00:00.000Z',
  shipment_uuid: 's1',
  shipment_no: '1006020770',
  operation_id: null,
  vessel_name: 'BG. AS MARINA 12',
  voyage_no: 'V1',
  shipment_date: '2026-11-18',
  other_pos: null,
  ...o,
});

describe('COMMERCIAL_SHIPMENT_DOCS_SQL', () => {
  it('takes only BL and SI, never a deleted file or a cancelled shipment, and leaves Contract to COD\'s own card', () => {
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain("d.document_type IN ('SI', 'BL')");
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain('d.deleted_at IS NULL');
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain("<> 'CANCELLED'");
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).not.toContain("'CONTRACT'");
  });
  it('reaches a PO\'s voyages the three ways the Edit Shipment modal does, with the PO as the only parameter', () => {
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain('s.contract_id IN (SELECT id FROM po)'); // its own shipment rows
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain('JOIN contract_stos cs'); // by STO
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain('s2.operation_id'); // by operation
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain('$1');
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).not.toContain('$2');
  });
});

describe('groupShipmentDocs', () => {
  it('groups by shipment row, keeps the query order, and puts BL before SI, newest first', () => {
    const groups = groupShipmentDocs([
      row({ id: 'si1', document_type: 'SI', upload_date: '2026-11-19T00:00:00.000Z' }),
      row({ id: 'bl-old', document_type: 'BL', upload_date: '2026-11-10T00:00:00.000Z' }),
      row({ id: 'bl-new', document_type: 'BL', upload_date: '2026-11-21T00:00:00.000Z' }),
      row({ id: 'x', shipment_uuid: 's2', vessel_name: 'MT. OTHER', shipment_date: '2026-10-01' }),
    ]);
    expect(groups.map((g) => g.shipmentId)).toEqual(['s1', 's2']);
    expect(groups[0].documents.map((d) => d.id)).toEqual(['bl-new', 'bl-old', 'si1']);
    expect(groups[0]).toMatchObject({ reference: '1006020770', vesselName: 'BG. AS MARINA 12', voyageNo: 'V1', date: '2026-11-18' });
  });
  it('lists the other POs of a shared voyage and none when it belongs to this PO alone', () => {
    const [shared] = groupShipmentDocs([row({ other_pos: ['1001033396', ' 1001033411 '] })]);
    expect(shared.sharedWithPos).toEqual(['1001033396', '1001033411']);
    const [alone] = groupShipmentDocs([row({ other_pos: null })]);
    expect(alone.sharedWithPos).toEqual([]);
  });
  it('turns a size that arrives as text into a number, and a missing one into null', () => {
    const [g] = groupShipmentDocs([row({ id: 'a', file_size: '2048' }), row({ id: 'b', file_size: null })]);
    expect(g.documents.find((d) => d.id === 'a')?.sizeBytes).toBe(2048);
    expect(g.documents.find((d) => d.id === 'b')?.sizeBytes).toBeNull();
  });
  it('falls back to the operation id when the voyage has no STO, and ignores any other document type', () => {
    const groups = groupShipmentDocs([row({ shipment_no: null, operation_id: 'OP-123' }), row({ id: 'c', document_type: 'CONTRACT' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reference).toBe('OP-123');
    expect(groups[0].documents).toHaveLength(1);
  });
});

describe('uploader and History of KLIP uploads', () => {
  it("reads the uploader from documents.uploaded_by, else from the upload's audit entry bounded by time (audit_logs has no entity_id index)", () => {
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain('uu.username');
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain("al.entity_type = 'DOCUMENT'");
    expect(COMMERCIAL_SHIPMENT_DOCS_SQL).toContain('al."timestamp" >= d.upload_date');
  });
  it('carries the uploader into the group and turns each file into an ADD entry badged as KLIP, newest first', () => {
    const groups = groupShipmentDocs([
      row({ id: 'bl1', document_type: 'BL', upload_date: '2026-11-12T12:10:00.000Z', uploaded_by_name: 'ryan.pohan' }),
      row({ id: 'si1', document_type: 'SI', upload_date: '2026-11-13T09:00:00.000Z', uploaded_by_name: null }),
    ]);
    expect(groups[0].documents.find((d) => d.id === 'bl1')?.uploadedBy).toBe('ryan.pohan');
    const history = shipmentDocsAsHistory(groups);
    expect(history.map((h) => h.id)).toEqual(['klip-si1', 'klip-bl1']);
    expect(history[1]).toMatchObject({ action_type: 'ADD', source: 'KLIP', user_name: 'ryan.pohan', document_type_label: 'Shipment Docs · BL' });
    expect(history[0].user_name).toBeNull();
  });
});
