import { describe, expect, it } from 'vitest';
import { dedupeShippingPerformanceRows } from '../services/shippingPerformance.service';

describe('dedupeShippingPerformanceRows', () => {
  it('keeps one row per PO+STO preferring numeric SAP shipment_id', () => {
    const rows = dedupeShippingPerformanceRows([
      {
        id: 'a',
        shipment_id: 'MNL-123-1',
        sto_number: '1646000083',
        po_number: '1641000216',
        vessel_name: 'BG GLORY 7',
      },
      {
        id: 'b',
        shipment_id: '1646000083',
        sto_number: '1646000083',
        po_number: '1641000216',
        vessel_name: 'AS GLORY 7',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('b');
  });

  it('does not collapse rows without both PO and STO', () => {
    const rows = dedupeShippingPerformanceRows([
      { id: '1', shipment_id: 'x', sto_number: null, po_number: '1641000216' },
      { id: '2', shipment_id: 'y', sto_number: null, po_number: '1641000216' },
    ]);
    expect(rows).toHaveLength(2);
  });
});
