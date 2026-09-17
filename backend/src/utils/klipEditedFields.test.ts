import { describe, expect, it } from 'vitest';
import {
  SHIPMENT_PROVENANCE_COLUMNS,
  TRUCKING_PROVENANCE_COLUMNS,
  VESSEL_LOADING_PORT_PROVENANCE_COLUMNS,
  buildKlipEditedFieldsChangedSetSql,
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

/**
 * The per-port editor saves the whole form, so the marker there has to come from a comparison
 * against the stored row - "the request supplied it" would claim a user authored values the form
 * merely displayed.
 */
describe('buildKlipEditedFieldsChangedSetSql', () => {
  it('marks a column only when the incoming value differs from the stored one', () => {
    const sql = buildKlipEditedFieldsChangedSetSql([
      { column: 'ata_vessel_arrival', placeholder: '$12' },
      { column: 'quality_ffa', placeholder: '$5' },
    ]);
    expect(sql).toContain("CASE WHEN $12 IS DISTINCT FROM ata_vessel_arrival THEN ARRAY['ata_vessel_arrival']");
    expect(sql).toContain("CASE WHEN $5 IS DISTINCT FROM quality_ffa THEN ARRAY['quality_ffa']");
  });

  it('uses IS DISTINCT FROM, so NULL to a value counts as a change', () => {
    const sql = buildKlipEditedFieldsChangedSetSql([{ column: 'quality_mi', placeholder: '$6' }]);
    expect(sql).toContain('IS DISTINCT FROM');
    expect(sql).not.toMatch(/\$6\s*<>\s*quality_mi/);
  });

  it('keeps what was already recorded', () => {
    const sql = buildKlipEditedFieldsChangedSetSql([{ column: 'quality_mi', placeholder: '$6' }]);
    expect(sql).toContain("COALESCE(klip_edited_fields, '{}')");
  });

  it('emits nothing for an empty list, so callers can skip the clause', () => {
    expect(buildKlipEditedFieldsChangedSetSql([])).toBe('');
  });

  it('does not track ETA, which SAP never supplies', () => {
    expect(VESSEL_LOADING_PORT_PROVENANCE_COLUMNS.some((c) => c.startsWith('eta_'))).toBe(false);
    expect(VESSEL_LOADING_PORT_PROVENANCE_COLUMNS).toContain('ata_vessel_arrival');
    expect(VESSEL_LOADING_PORT_PROVENANCE_COLUMNS).toContain('quality_ffa');
  });
});

/**
 * Measured against the dev database rather than assumed, because the code paths exist for all
 * three and only the data settles it: across 27,003 sap_processed_data rows, ETA keys appear 0
 * times and SF keys 0 times, while ATA appears 1,800 times.
 */
describe('fields SAP never supplies are not tracked', () => {
  it('leaves SFAL/SFBD off the shipment list', () => {
    expect(SHIPMENT_PROVENANCE_COLUMNS).not.toContain('sfal_qty');
    expect(SHIPMENT_PROVENANCE_COLUMNS).not.toContain('sfbd_qty');
  });

  it('leaves daily planning off the trucking list', () => {
    expect(TRUCKING_PROVENANCE_COLUMNS).not.toContain('daily_deliverables');
  });

  it('still tracks the fields SAP does supply', () => {
    expect(SHIPMENT_PROVENANCE_COLUMNS).toContain('actual_vessel_qty_receive');
    expect(SHIPMENT_PROVENANCE_COLUMNS).toContain('quantity_delivered');
    expect(TRUCKING_PROVENANCE_COLUMNS).toContain('loading_location');
  });
});
