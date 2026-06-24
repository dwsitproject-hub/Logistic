import { describe, expect, it } from 'vitest';
import { buildAtaOverridePayload, emptyAtaFields } from './shipmentAtaFields';

describe('buildAtaOverridePayload', () => {
  it('returns null when nothing changed', () => {
    const base = emptyAtaFields();
    base.ata_vessel_arrival_at_loading_port = '2024-01-01';
    expect(buildAtaOverridePayload(base, base)).toBeNull();
  });

  it('includes changed fields only', () => {
    const base = emptyAtaFields();
    const current = { ...base, ata_vessel_arrival_at_loading_port: '2024-02-01' };
    expect(buildAtaOverridePayload(current, base)).toEqual({
      ata_vessel_arrival_at_loading_port: '2024-02-01',
    });
  });

  it('sends null to clear override back to SAP fallback', () => {
    const base = emptyAtaFields();
    base.ata_vessel_arrival_at_loading_port = '2024-02-01';
    const current = { ...base, ata_vessel_arrival_at_loading_port: '' };
    expect(buildAtaOverridePayload(current, base)).toEqual({
      ata_vessel_arrival_at_loading_port: null,
    });
  });
});
