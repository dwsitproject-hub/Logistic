import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('the STO key used to fill vessel fields from SAP', () => {
  it("prefers the shipment's own numeric STO over operation_id (an OP-SEA id KLIP assigned never matches a SAP STO)", () => {
    const src = readFileSync(resolve(__dirname, 'shipmentVesselFromSap.service.ts'), 'utf8').replace(/\r/g, '');
    const start = src.indexOf('l.effective_sto,');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf(') = TRIM($1::text)', start));
    const numeric = block.indexOf("~ '^[0-9]+$'");
    expect(numeric).toBeGreaterThan(-1);
    expect(numeric).toBeLessThan(block.indexOf('s.operation_id'));
  });
});
