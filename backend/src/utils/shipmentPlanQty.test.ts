import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sqlSiblingShipmentKlipQtyExpr } from './contractDetailsForStoSql';
import { SHIPMENT_LIST_SORT_COLUMNS } from './shipmentListSortSql';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const migration = readFileSync(
  join(__dirname, '..', 'database', 'migrations', '227_shipments_quantity_shipment_plan.sql'),
  'utf8',
);

describe('Qty Shipment Plan', () => {
  it('is its own nullable column in kg, with no backfill', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS quantity_shipment_plan NUMERIC(15, 2)');
    expect(migration).not.toMatch(/\bUPDATE\b/i);
  });

  it('is written by Add New Shipment to that column only - never to delivered or delivered_klip', () => {
    const create = read('services', 'createShipment.service.ts');
    expect(create).toContain('quantityShipmentPlanByContract');
    expect(create).toContain('quantity_shipment_plan = COALESCE($26::numeric, quantity_shipment_plan)');
    // the plan has its own variable; the delivered variables are still fed by quantityDeliveredByContract alone
    expect(create).toContain('const quantityShipmentPlanKg = parsePositiveQtyKg(planByContractMap[contractIdKey]);');
    expect(create).toContain('const quantityDeliveredKlipKg = parsePositiveQtyKg(qtyByContractMap[contractIdKey]);');
  });

  it('reduces no quantity: nothing that computes Delivered / Outstanding reads it', () => {
    for (const f of [
      ['utils', 'shipmentListQtySql.ts'],
      ['utils', 'shipmentManualQtyResolveSql.ts'],
      ['utils', 'shipmentOutstandingQtySql.ts'],
      ['utils', 'contractGlobalOutstandingSql.ts'],
      ['utils', 'shippingPerformanceStoMetricsSql.ts'],
      ['utils', 'shipmentPipelineDailySummarySql.ts'],
    ]) {
      expect(read(...f), f.join('/')).not.toContain('quantity_shipment_plan');
    }
  });

  it('the modal PO table reads it from the sibling shipment, per PO', () => {
    expect(sqlSiblingShipmentKlipQtyExpr('pl.contract_number', 'plan')).toContain('s.quantity_shipment_plan');
    expect(sqlSiblingShipmentKlipQtyExpr('pl.contract_number', 'delivered')).not.toContain('quantity_shipment_plan');
  });

  it('the list sums it per STO group (NULL when unplanned) and can sort by it', () => {
    expect(read('controllers', 'shipment.controller.ts')).toContain('SUM(s.quantity_shipment_plan) as quantity_shipment_plan');
    expect(SHIPMENT_LIST_SORT_COLUMNS.quantity_shipment_plan).toBe('fs.quantity_shipment_plan');
  });
});
