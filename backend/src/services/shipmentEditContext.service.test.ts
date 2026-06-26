import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('shipmentEditContext.service', () => {
  it('resolve query uses shipments+contracts only (no sap_processed_data)', () => {
    const src = readFileSync(
      resolve(__dirname, 'shipmentEditContext.service.ts'),
      'utf8',
    );
    expect(src).toContain('FROM shipments s');
    expect(src).toContain('INNER JOIN contracts c');
    expect(src).not.toContain('sap_processed_data');
    expect(src).toContain('operation_id');
    expect(src).toContain('numeric_shipment_id');
  });
});
