import { describe, expect, it } from 'vitest';
import {
  SHIPMENT_PROVENANCE_COLUMNS,
  TRUCKING_PROVENANCE_COLUMNS,
  buildKlipEditedFieldsSetSql,
  klipEditedFieldsToRecord,
} from './klipEditedFields';

/**
 * Provenance exists because most KLIP-labelled columns are shared with the SAP import, which fills
 * whatever a user left empty - after which nothing distinguishes the two. The marker is only worth
 * having if it is never inferred, so these pin exactly what gets recorded.
 */
describe('klipEditedFieldsToRecord', () => {
  it('records only the columns SAP also writes', () => {
    const written = ['quantity_delivered', 'quantity_delivered_klip', 'bl_quantity', 'updated_at'];
    expect(klipEditedFieldsToRecord(written, SHIPMENT_PROVENANCE_COLUMNS)).toEqual([
      'quantity_delivered',
    ]);
  });

  it('records nothing when the save touched no ambiguous column', () => {
    expect(klipEditedFieldsToRecord(['bl_quantity', 'remarks'], SHIPMENT_PROVENANCE_COLUMNS)).toEqual([]);
  });

  it('records the ATA columns, which is where the report started', () => {
    const written = ['ata_arrival', 'ata_discharge_complete'];
    expect(klipEditedFieldsToRecord(written, SHIPMENT_PROVENANCE_COLUMNS)).toEqual([
      'ata_arrival',
      'ata_discharge_complete',
    ]);
  });

  it('records Qty Receive, the field with no KLIP column of its own', () => {
    expect(
      klipEditedFieldsToRecord(['actual_vessel_qty_receive'], SHIPMENT_PROVENANCE_COLUMNS),
    ).toEqual(['actual_vessel_qty_receive']);
  });

  it('de-duplicates and sorts, so the stored array is stable', () => {
    const written = ['quantity_delivered', 'quantity_delivered', 'ata_arrival'];
    expect(klipEditedFieldsToRecord(written, SHIPMENT_PROVENANCE_COLUMNS)).toEqual([
      'ata_arrival',
      'quantity_delivered',
    ]);
  });

  it('keeps each table to its own column list', () => {
    expect(klipEditedFieldsToRecord(['loading_location'], TRUCKING_PROVENANCE_COLUMNS)).toEqual([
      'loading_location',
    ]);
    // A shipment column must not be recorded against a trucking row.
    expect(klipEditedFieldsToRecord(['ata_arrival'], TRUCKING_PROVENANCE_COLUMNS)).toEqual([]);
  });
});

describe('buildKlipEditedFieldsSetSql', () => {
  it('unions rather than replaces, so an earlier edit is not erased', () => {
    const sql = buildKlipEditedFieldsSetSql('$7');
    expect(sql).toContain('klip_edited_fields');
    expect(sql).toContain('||');
    expect(sql).toContain('DISTINCT');
    expect(sql).toContain('$7::text[]');
    expect(sql).not.toMatch(/klip_edited_fields\s*=\s*\$7/);
  });
});
