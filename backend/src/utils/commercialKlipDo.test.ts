import { describe, expect, it } from 'vitest';
import { buildCommercialDocumentsListQuery, buildCommercialDocumentsSummaryQuery } from './commercialDocumentsQuerySql';
import { COMMERCIAL_KLIP_DO_CONTRACTS_SQL, COMMERCIAL_KLIP_DO_FILES_SQL, klipDoAsHistory, klipDoFiles, type KlipDoRow } from './commercialKlipDo';

const row = (o: Partial<KlipDoRow>): KlipDoRow => ({ id: 'd1', file_name: 'DO-1.pdf', file_size: 1024, mime_type: 'application/pdf', upload_date: '2026-11-20T10:00:00.000Z', uploaded_by_name: null, ...o });

describe('KLIP DO files of a PO', () => {
  it("takes only non-deleted 'DO' documents, reached through the trucking operation or straight from the contract, with the PO as the only parameter", () => {
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).toContain("d.document_type = 'DO'");
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).toContain('d.deleted_at IS NULL');
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).toContain('d.contract_id IN (SELECT id FROM po)');
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).toContain('t.contract_id IN (SELECT id FROM po)');
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).toContain('trucking_operations t ON t.id = d.trucking_operation_id');
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).toContain('$1');
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).not.toContain('$2');
    // OTHER (the old Trucking uploads) stays out until Ryan reclassifies them
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).not.toContain("'OTHER'");
  });
  it('reads the uploader from documents.uploaded_by first, the upload audit (bounded by time) as the fallback', () => {
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).toContain('uu.username');
    expect(COMMERCIAL_KLIP_DO_FILES_SQL).toContain('al."timestamp" >= d.upload_date');
  });
  it('turns rows into files, keeping the order, a text size as a number and a blank uploader as null', () => {
    const files = klipDoFiles([row({ id: 'a', file_size: '2048', uploaded_by_name: ' ryan.pohan ' }), row({ id: 'b', file_size: null })]);
    expect(files.map((f) => f.id)).toEqual(['a', 'b']);
    expect(files[0]).toMatchObject({ sizeBytes: 2048, uploadedBy: 'ryan.pohan' });
    expect(files[1].sizeBytes).toBeNull();
    expect(files[1].uploadedBy).toBeNull();
  });
  it('shows each file as an ADD entry under the DO type, badged as KLIP', () => {
    const history = klipDoAsHistory(klipDoFiles([row({ id: 'a', uploaded_by_name: 'ryan.pohan' }), row({ id: 'x', upload_date: null })]), 'Delivery Order');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: 'klip-do-a', document_type: 'delivery_order', action_type: 'ADD', source: 'KLIP', user_name: 'ryan.pohan', document_type_label: 'Delivery Order' });
  });
});

describe('the DO slot in the COD list', () => {
  it('sets the DO flag of a PO when COD holds one OR KLIP holds a DO, starting the KLIP side from the documents of type DO', () => {
    const { countSql } = buildCommercialDocumentsListQuery({ completeness: 'complete' });
    expect(COMMERCIAL_KLIP_DO_CONTRACTS_SQL).toContain("d.document_type = 'DO'");
    expect(COMMERCIAL_KLIP_DO_CONTRACTS_SQL).toContain('d.deleted_at IS NULL');
    expect(countSql).toContain('klip_do_contracts AS (');
    expect(countSql).toContain('LEFT JOIN klip_do_contracts kdo ON kdo.contract_id = cr.id');
    expect(countSql).toContain('OR kdo.contract_id IS NOT NULL) AS doc_delivery_order');
  });
  it('is the same flag the summary cards count, so the DO card and the list after a click agree', () => {
    const { sql } = buildCommercialDocumentsSummaryQuery({});
    expect(sql).toContain('kdo.contract_id IS NOT NULL) AS doc_delivery_order');
  });
});
