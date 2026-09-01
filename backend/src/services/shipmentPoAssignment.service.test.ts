import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { poLineKey, lookupPoLineMetricKg } from './shipmentPoAssignment.service';
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

  it('resolveAddPoGate blocks cancelled shipments only', () => {
    expect(
      resolveAddPoGate({
        lookupKey: '1016010783',
        hasSapSto: true,
        shipmentStatus: 'PLANNED',
      }).can_add_po,
    ).toBe(true);

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

  it('list SQL uses global OS Actual outstanding as the add-PO eligibility filter', () => {
    const src = readFileSync(
      resolve(__dirname, 'shipmentPoAssignment.service.ts'),
      'utf8',
    );
    expect(src).toContain('buildSeaContractsQtyMoveCte');
    expect(src).toContain('PO_GLOBAL_OUTSTANDING_ACTUAL_EXPR');
    expect(src).toContain('PO_GLOBAL_OUTSTANDING_PLANNING_EXPR');
    expect(src).toContain('This PO has no outstanding actual quantity remaining');
    expect(src).not.toContain('exceeds OS Qty (Actual)');
    expect(src).not.toContain('exceeds OS Qty (Plan)');
    expect(src).not.toContain('poLineHasSapStoSql');
  });

  it('always upserts assignment on attach including plan qty 0 (keeps Edit PO list link)', () => {
    const src = readFileSync(
      resolve(__dirname, 'shipmentPoAssignment.service.ts'),
      'utf8',
    );
    expect(src).toContain('await upsertPoQtyAssignment(context.lookup_key, contractNumber, poNumber, qtyKg)');
    expect(src).not.toMatch(/if \(qtyKg > 0\) \{\s*await upsertPoQtyAssignment/);
    // upsert itself must persist zero-qty link rows
    expect(src).toContain('Always keep a row (including 0 kg)');
    expect(src).not.toMatch(/if \(qtyKg > 0\) \{\s*await query\(\s*`\s*INSERT INTO user_sto_contract_assignments/);
  });

  it('lookupPoLineMetricKg falls back to the unique contract when PO key misses', () => {
    const byKey = new Map<string, number>([[poLineKey('1014003118', '1001030001'), 500_000]]);
    expect(lookupPoLineMetricKg(byKey, '1014003118', null)).toBe(500_000);
    expect(lookupPoLineMetricKg(byKey, '1014003118', '1001030001')).toBe(500_000);
    expect(lookupPoLineMetricKg(byKey, '999', 'x')).toBe(0);
  });
});
