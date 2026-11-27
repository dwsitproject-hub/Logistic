import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildShipmentDocumentUploadSubdir,
  buildUniqueStoredFilename,
  resolveUploadAbsolutePath,
  shipmentNasFileToken,
  shipmentStructuredDocKindFromType,
  shipmentUploadFolderKind,
  toRelativeUploadPath,
} from './fileUpload';

describe('fileUpload utils', () => {
  it('buildUniqueStoredFilename keeps extension and avoids collisions', () => {
    const a = buildUniqueStoredFilename('My Doc.pdf');
    const b = buildUniqueStoredFilename('My Doc.pdf');
    expect(a).toMatch(/^[0-9a-f-]{36}_My_Doc\.pdf$/i);
    expect(b).not.toEqual(a);
  });

  it('toRelativeUploadPath stores cwd-relative posix paths', () => {
    const abs = path.join(process.cwd(), 'uploads', 'abc.pdf');
    expect(toRelativeUploadPath(abs)).toBe('uploads/abc.pdf');
  });

  it('buildShipmentDocumentUploadSubdir returns Synology-ready relative paths', () => {
    expect(buildShipmentDocumentUploadSubdir('abc-123', 'contract')).toBe(
      'documents/shipment/contract/abc-123',
    );
    expect(buildShipmentDocumentUploadSubdir('abc-123', 'si')).toBe('documents/shipment/si/abc-123');
    expect(buildShipmentDocumentUploadSubdir('abc-123', 'bl')).toBe('documents/shipment/bl/abc-123');
    expect(buildShipmentDocumentUploadSubdir('abc-123', 'sld')).toBe('documents/shipment/sld/abc-123');
    expect(buildShipmentDocumentUploadSubdir('abc-123', 'sdd')).toBe('documents/shipment/sdd/abc-123');
  });

  it('shipmentStructuredDocKindFromType maps SLD and SDD only', () => {
    expect(shipmentStructuredDocKindFromType('SLD')).toBe('sld');
    expect(shipmentStructuredDocKindFromType('sdd')).toBe('sdd');
    expect(shipmentStructuredDocKindFromType('QUANTITY_ADJUSTMENT')).toBeNull();
    expect(shipmentStructuredDocKindFromType('OTHER')).toBeNull(); // the folder migration classifies rows with this one: an OTHER row must stay out of it
  });

  it('shipmentUploadFolderKind adds the Others folder on top of the structured kinds', () => {
    expect(shipmentUploadFolderKind('OTHER')).toBe('other');
    expect(shipmentUploadFolderKind(' other ')).toBe('other');
    expect(shipmentUploadFolderKind('SLD')).toBe('sld');
    expect(shipmentUploadFolderKind('BL')).toBe('bl');
    expect(shipmentUploadFolderKind('INVOICE')).toBeNull();
    expect(buildShipmentDocumentUploadSubdir('abc-123', 'other')).toBe('documents/shipment/other/abc-123');
  });

  it('shipmentNasFileToken maps the three shipment documents', () => {
    expect(shipmentNasFileToken('contract')).toBe('ctr');
    expect(shipmentNasFileToken('si')).toBe('si');
    expect(shipmentNasFileToken('bl')).toBe('bl');
    expect(shipmentNasFileToken('sld')).toBeNull();
  });

  it('resolveUploadAbsolutePath supports relative and absolute stored paths', () => {
    const rel = 'uploads/abc.pdf';
    expect(path.normalize(resolveUploadAbsolutePath(rel))).toBe(
      path.normalize(path.join(process.cwd(), rel)),
    );
    const abs = path.join(process.cwd(), 'uploads', 'legacy.pdf');
    expect(path.normalize(resolveUploadAbsolutePath(abs))).toBe(path.normalize(abs));
  });
});
