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
    expect(src).toContain('sqlShipmentResolvedDeliveryKg');
    expect(src).toContain('sqlShipmentResolvedReceiveKg');
    expect(src).toContain('sqlIsContractSapClosedForStoExpr');
    expect(src).toContain('CONTRACT_REAL_STO_KEYS_SQL');
    expect(src).toContain('sqlContractStoListShipmentMatchPred');
    expect(src).toContain('sp.id');
  });

  it('resolves trucking STO Delivery/Receive with Open→WB / Close→SAP helpers', () => {
    const src = readFileSync(
      join(__dirname, '../controllers/contract.controller.ts'),
      'utf8',
    );
    expect(src).toContain('sqlTruckingResolvedDeliveryQty');
    expect(src).toContain('sqlTruckingResolvedReceiveQty');
    // Prefer-SAP-if->0 JS map must not remain (would hide WB while GR Open).
    expect(src).not.toContain('quantity_receive_sap');
    expect(src).not.toContain('quantity_delivered_sap');
  });

  it('hides deduped and non-FRC/LCO trucking ops from Contract Details STO list/detail', () => {
    const src = readFileSync(
      join(__dirname, '../controllers/contract.controller.ts'),
      'utf8',
    );
    const uses = src.match(/sqlContractDetailsTruckingOpVisible\('t', 'c'\)/g) ?? [];
    // op_fallback_keys, LATERAL attach, and logistics-sto-detail
    expect(uses.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("import { sqlContractDetailsTruckingOpVisible } from '../utils/truckingOperationUniqueness'");
  });

  it('gates List STO shipment vs trucking by incoterm helper (CIF not dual MIX rows)', () => {
    const src = readFileSync(
      join(__dirname, '../controllers/contract.controller.ts'),
      'utf8',
    );
    expect(src).toContain('resolveContractStoInformationLogisticsIncludes');
    expect(src).not.toMatch(
      /includeTrucking\s*=\s*[\s\S]*transportMode === 'MIX'[\s\S]*isTruckingPageIncoterm/,
    );
  });
});
