import { describe, expect, it } from 'vitest';
import { resolveEffectiveDeliveryEnd } from './latePerformance.service';

describe('resolveEffectiveDeliveryEnd', () => {
  it('uses contracts.delivery_end_date when present', () => {
    const d = resolveEffectiveDeliveryEnd({ delivery_end_date: '2026-06-15' });
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(15);
  });

  it('falls back to SAP contract JSON due_date_delivery_end', () => {
    const d = resolveEffectiveDeliveryEnd({
      delivery_end_date: null,
      latest_spd_data: { contract: { due_date_delivery_end: '19-Sep-25' } },
    });
    expect(d?.getFullYear()).toBe(2025);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(19);
  });

  it('returns null when DB and SAP due end are both empty (Open contract skip case)', () => {
    expect(
      resolveEffectiveDeliveryEnd({
        delivery_end_date: null,
        latest_spd_data: { contract: { status: 'Open', due_date_delivery_end: '' } },
      }),
    ).toBeNull();
  });
});
