import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { poLineKey } from './shipmentPoAssignment.service';
import { resolveAddPoGate } from './shipmentEditContext.service';

describe('shipmentEditContext.service', () => {
  it('resolve query joins shipments and contracts; add-po gate uses sap_processed_data', () => {
    const src = readFileSync(
      resolve(__dirname, 'shipmentEditContext.service.ts'),
      'utf8',
    );
    expect(src).toContain('FROM shipments s');
    expect(src).toContain('INNER JOIN contracts c');
    expect(src).toContain('sap_processed_data');
    expect(src).toContain('operation_id');
    expect(src).toContain('can_add_po');
    expect(src).toContain('has_sap_sto');
  });

  it('resolveAddPoGate blocks SAP STO and cancelled shipments', () => {
    expect(
      resolveAddPoGate({
        lookupKey: '1016010783',
        hasSapSto: true,
        shipmentStatus: 'PLANNED',
      }).can_add_po,
    ).toBe(false);

    expect(
      resolveAddPoGate({
        lookupKey: 'OP-SEA-010125-001',
        hasSapSto: false,
        shipmentStatus: 'CANCELLED',
      }).can_add_po,
    ).toBe(false);

    expect(
      resolveAddPoGate({
        lookupKey: 'OP-SEA-010125-001',
        hasSapSto: false,
        shipmentStatus: 'PLANNED',
      }).can_add_po,
    ).toBe(true);
  });
});

describe('shipmentPoAssignment.service', () => {
  it('poLineKey is case-insensitive and normalizes po', () => {
    expect(poLineKey('C100', 'PO-1')).toBe('c100::po-1');
    expect(poLineKey('C100', null)).toBe('c100::');
  });

  it('list SQL uses global outstanding and poLineHasSapSto', () => {
    const src = readFileSync(
      resolve(__dirname, 'shipmentPoAssignment.service.ts'),
      'utf8',
    );
    expect(src).toContain('buildQtyMoveCte');
    expect(src).toContain('sqlContractGlobalOutstandingExpr');
    expect(src).toContain('poLineHasSapStoSql');
    expect(src).not.toContain('resolveStoGroupContractIds');
  });
});
