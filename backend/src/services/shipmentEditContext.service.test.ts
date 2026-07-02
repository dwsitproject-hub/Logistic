import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveAddPoGate } from './shipmentEditContext.service';

describe('shipmentEditContext.service (legacy file checks)', () => {
  it('exports add-po gate helpers', () => {
    expect(
      resolveAddPoGate({
        lookupKey: 'OP-1',
        hasSapSto: false,
        shipmentStatus: 'PLANNED',
      }).can_add_po,
    ).toBe(true);
  });
});
