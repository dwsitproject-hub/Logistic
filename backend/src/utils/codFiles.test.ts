import { describe, expect, it } from 'vitest';
import { COD_FILES_SQL, groupCodFiles, isCodFileType, latestCodContracts, type CodFileRow } from './codFiles';

const row = (over: Partial<CodFileRow>): CodFileRow => ({
  id: 'id',
  po_number: '1011003087',
  document_type: 'contract',
  file_name: 'c.pdf',
  file_size: 100,
  mime_type: 'application/pdf',
  created_at: '2026-11-10T00:00:00.000Z',
  uploaded_by_name: 'Sari',
  ...over,
});

describe('groupCodFiles', () => {
  it('numbers the versions from the oldest and marks the newest as the latest, whatever order the rows come in', () => {
    const groups = groupCodFiles([
      row({ id: 'v2', created_at: '2026-11-12T10:00:00.000Z' }),
      row({ id: 'v3', created_at: '2026-11-20T10:00:00.000Z' }),
      row({ id: 'v1', created_at: '2026-11-05T10:00:00.000Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].versions.map((v) => [v.id, v.version, v.isLatest])).toEqual([
      ['v3', 3, true],
      ['v2', 2, false],
      ['v1', 1, false],
    ]);
  });

  it('keeps each PO and each type apart', () => {
    const groups = groupCodFiles([
      row({ id: 'a', po_number: 'PO-A' }),
      row({ id: 'b', po_number: 'PO-B' }),
      row({ id: 'c', po_number: 'PO-A', document_type: 'delivery_order' }),
    ]);
    expect(groups.map((g) => `${g.poNumber}/${g.type}/${g.versions.length}`).sort()).toEqual(['PO-A/contract/1', 'PO-A/delivery_order/1', 'PO-B/contract/1']);
  });

  it('leaves out a type KLIP does not read (invoices, tax documents) and a row with no PO', () => {
    const groups = groupCodFiles([
      row({ id: 'inv', document_type: 'invoice_fp_full' }),
      row({ id: 'faktur', document_type: 'faktur_pajak' }),
      row({ id: 'nopo', po_number: null }),
      row({ id: 'blank', po_number: '  ' }),
      row({ id: 'ok' }),
    ]);
    expect(groups.flatMap((g) => g.versions.map((v) => v.id))).toEqual(['ok']);
  });

  it('reads the size and the uploader, and tolerates a missing size, uploader and time', () => {
    const [g] = groupCodFiles([row({ id: 'x', file_size: '2048', uploaded_by_name: '  ', created_at: null })]);
    expect(g.versions[0]).toMatchObject({ sizeBytes: 2048, uploadedBy: null, uploadedAt: null });
    const [g2] = groupCodFiles([row({ file_size: null })]);
    expect(g2.versions[0].sizeBytes).toBeNull();
  });
});

describe('latestCodContracts', () => {
  it('gives the latest Contract of each PO in the order asked, and skips a PO that has none', () => {
    const groups = groupCodFiles([
      row({ id: 'b1', po_number: 'PO-B', created_at: '2026-11-01T00:00:00.000Z' }),
      row({ id: 'b2', po_number: 'PO-B', created_at: '2026-11-09T00:00:00.000Z' }),
      row({ id: 'a1', po_number: 'PO-A' }),
      row({ id: 'do-c', po_number: 'PO-C', document_type: 'delivery_order' }),
    ]);
    expect(latestCodContracts(groups, ['PO-B', 'PO-C', 'PO-A']).map((x) => [x.poNumber, x.version.id])).toEqual([
      ['PO-B', 'b2'],
      ['PO-A', 'a1'],
    ]);
  });
});

describe('the COD types KLIP reads', () => {
  it('are Contract, Addendum and DO - never an invoice or a tax document', () => {
    expect(isCodFileType('contract')).toBe(true);
    expect(isCodFileType('delivery_order')).toBe(true);
    expect(isCodFileType('invoice_fp_dp')).toBe(false);
    expect(isCodFileType('faktur_pajak')).toBe(false);
  });

  it('the SQL filters by PO keys and types, and joins the uploader', () => {
    expect(COD_FILES_SQL).toContain('f.po_number = ANY($1::text[])');
    expect(COD_FILES_SQL).toContain('f.document_type = ANY($2::text[])');
    expect(COD_FILES_SQL).toContain('LEFT JOIN users u ON u.id = f.uploaded_by');
  });
});
