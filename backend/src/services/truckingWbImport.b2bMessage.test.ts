import { describe, expect, it } from 'vitest';
import { formatWbB2bChildRejectReason } from './truckingWbImport.service';

describe('truckingWbImport B2B child messaging', () => {
  it('mentions origin PO when Contract Reff PO is known', () => {
    const msg = formatWbB2bChildRejectReason('1641000321', '1001029450');
    expect(msg).toContain('B2B child');
    expect(msg).toContain('1641000321');
    expect(msg).toContain('1001029450');
    expect(msg).toMatch(/origin PO only/i);
  });

  it('falls back when origin PO is unknown', () => {
    const msg = formatWbB2bChildRejectReason('1641000321', '');
    expect(msg).toContain('B2B child');
    expect(msg).toContain('1641000321');
    expect(msg).toMatch(/origin \(parent\) PO only/i);
  });
});
