import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pickShipmentEditLookupKey, resolveAddPoGate } from './shipmentEditContext.service';

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

  it('links Add-PO assignments into linked_contracts for edit context', () => {
    const src = readFileSync(resolve(__dirname, 'shipmentEditContext.service.ts'), 'utf8');
    expect(src).toContain('user_sto_contract_assignments');
    expect(src).toContain('linked_contracts AS');
    expect(src).toContain('TRIM(u.sto_number::text) = a.lookup_key');
  });

  it('prefers FOB Type V STO, then numeric shipment_id, then operation_id, over unrelated contract_stos', () => {
    const src = readFileSync(resolve(__dirname, 'shipmentEditContext.service.ts'), 'utf8');
    const anchorBlock = src.slice(src.indexOf('WITH anchor AS'), src.indexOf('linked_contracts AS'));
    const coalesce = anchorBlock.slice(anchorBlock.indexOf('COALESCE('));
    const fob = coalesce.indexOf("= 'FOB'");
    const shipmentIdCase = coalesce.indexOf("s.shipment_id::text), '') ~ '^[0-9]+$'");
    const opId = coalesce.indexOf("NULLIF(TRIM(s.operation_id::text), '')");
    const fallbackStos = coalesce.indexOf('ORDER BY cs.updated_at DESC NULLS LAST');
    expect(fob).toBeGreaterThan(-1);
    expect(shipmentIdCase).toBeGreaterThan(fob);
    expect(opId).toBeGreaterThan(shipmentIdCase);
    expect(fallbackStos).toBeGreaterThan(opId);
    expect(coalesce).toContain('vessel_name');
  });
});

describe('pickShipmentEditLookupKey', () => {
  it('keeps resolved key when preferred STO is blank', () => {
    expect(
      pickShipmentEditLookupKey({
        resolvedKey: '1016010951',
        preferredSto: '',
        seaVesselSto: '1016010951',
        shipmentIdNumeric: '1016010991',
      }),
    ).toBe('1016010951');
  });

  it('uses list Type V STO when shipment_id is the Type T sibling', () => {
    expect(
      pickShipmentEditLookupKey({
        resolvedKey: '1016010991',
        preferredSto: '1016010951',
        seaVesselSto: '1016010951',
        shipmentIdNumeric: '1016010991',
        contractStoNumbers: ['1016010951', '1016010991'],
      }),
    ).toBe('1016010951');
  });

  it('ignores an unrelated preferred STO', () => {
    expect(
      pickShipmentEditLookupKey({
        resolvedKey: '1016010951',
        preferredSto: '9999999999',
        seaVesselSto: '1016010951',
        shipmentIdNumeric: '1016010991',
        contractStoNumbers: ['1016010951', '1016010991'],
      }),
    ).toBe('1016010951');
  });
});
