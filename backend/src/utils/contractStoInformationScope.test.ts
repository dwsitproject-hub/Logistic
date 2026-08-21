import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('contract.controller sto-information shipment qty scope', () => {
  it('scopes shipment STO qty/delivered/receive by contract/PO helpers', () => {
    const src = readFileSync(
      join(__dirname, '../controllers/contract.controller.ts'),
      'utf8',
    );
    // Unscoped SUM-by-STO must not return (would inflate multi-PO shared STOs).
    expect(src).not.toContain(
      "WHERE NULLIF(TRIM(COALESCE(spd.sto_number::text, spd.data->'raw'->>'STO No.', spd.data->'raw'->>'STO Number')), '') = TRIM(sb.sto_key::text)",
    );
    expect(src).toContain("stoKeyExpr: 'sk.sto_key'");
    expect(src).toContain('sqlSapStoQtyForContractPoExpr');
    expect(src).toContain('sqlSapQtyDeliveredForStoKeyExpr');
    expect(src).toContain('sqlSapQtyReceiveForStoKeyExpr');
    expect(src).toContain('CONTRACT_REAL_STO_KEYS_SQL');
  });
});
