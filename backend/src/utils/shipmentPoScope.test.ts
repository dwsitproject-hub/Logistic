import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHIPMENT_OUT_OF_SCOPE_MESSAGE, buildShipmentPageSeaIncotermScopeSql } from './shipmentIncotermScope';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('Add New Shipment only takes POs the Shipments page owns', () => {
  it('the scope is CIF / FOB / CFR on the effective incoterm - FRC / LCO (trucking) are outside it', () => {
    const sql = buildShipmentPageSeaIncotermScopeSql('c');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).not.toContain("'FRC'");
    expect(sql).not.toContain("'LCO'");
  });

  it('the message names the rule and where the other POs go', () => {
    expect(SHIPMENT_OUT_OF_SCOPE_MESSAGE).toMatch(/CIF \/ FOB \/ CFR/);
    expect(SHIPMENT_OUT_OF_SCOPE_MESSAGE).toMatch(/Trucking/);
  });

  it('the search, the validation and the creation all apply it - none can be used to get around the others', () => {
    const controller = read('controllers', 'shipment.controller.ts');
    const suggestions = controller.slice(
      controller.indexOf('export const getContractSuggestions'),
      controller.indexOf('export const getContractPurchaseOrders'),
    );
    expect(suggestions).toContain("buildShipmentPageSeaIncotermScopeSql('c')");

    const validate = controller.slice(
      controller.indexOf('export const validateContractNumber'),
      controller.indexOf('export const checkStoExists'),
    );
    expect(validate).toContain('in_shipment_scope');
    expect(validate).toContain('outOfScope: true');

    const create = read('services', 'createShipment.service.ts');
    expect(create).toContain('in_shipment_scope');
    expect(create).toContain('SHIPMENT_OUT_OF_SCOPE_MESSAGE');
  });
});
