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

  it('prefers operation_id over unrelated contract_stos for lookup_key', () => {
    const src = readFileSync(resolve(__dirname, 'shipmentEditContext.service.ts'), 'utf8');
    const anchorBlock = src.slice(src.indexOf('WITH anchor AS'), src.indexOf('linked_contracts AS'));
    const opId = anchorBlock.indexOf('NULLIF(TRIM(s.operation_id::text), \'\')');
    const contractStos = anchorBlock.indexOf('FROM contract_stos cs');
    expect(opId).toBeGreaterThan(-1);
    expect(contractStos).toBeGreaterThan(opId);
  });
});
