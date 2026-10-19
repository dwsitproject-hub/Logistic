import { describe, expect, it } from 'vitest';
import {
  sqlShipmentListPrimaryFieldAgg,
  sqlShipmentListPrimaryIdAgg,
  sqlShipmentListPrimaryOrderBy,
} from './shipmentListPrimaryShipmentSql';
import { sqlShipmentGroupStatusAgg } from './shipmentListFilters';

describe('shipmentListPrimaryShipmentSql', () => {
  it('prefers STO Type V and vessel_name in primary id agg', () => {
    const sql = sqlShipmentListPrimaryIdAgg();
    expect(sql).toContain("= 'V' THEN 0");
    expect(sql).toContain("= 'T' THEN 2");
    expect(sql).toContain('vessel_name');
  });

  it('prefers shipment_id matching sto key in array_agg order', () => {
    const sql = sqlShipmentListPrimaryIdAgg();
    expect(sql).toContain('s.shipment_id::text');
    expect(sql).toContain('s.ata_loading_complete IS NOT NULL');
    expect(sql).toContain('s.created_at DESC');
  });

  it('a manual ATA override counts as "ATA populated" only when the query joins the overrides table', () => {
    const plain = sqlShipmentListPrimaryOrderBy().replace(/\s+/g, ' ');
    expect(plain).not.toContain('sao.');

    const withOverride = sqlShipmentListPrimaryOrderBy(undefined, 'c', 'l', 's', undefined, 'sao').replace(/\s+/g, ' ');
    expect(withOverride).toContain('OR sao.ata_discharge_complete IS NOT NULL');
    expect(withOverride).toContain('OR sao.ata_sailed IS NOT NULL');
    // it extends the existing ATA rule, ahead of created_at DESC, so a finished voyage outranks a newer planned member
    expect(withOverride.indexOf('sao.ata_discharge_complete')).toBeLessThan(withOverride.lastIndexOf('created_at DESC'));
    expect(sqlShipmentListPrimaryIdAgg(undefined, 'c', 'l', 's', undefined, 'sao')).toContain('sao.ata_discharge_complete');
    expect(sqlShipmentListPrimaryFieldAgg('s.vessel_name', undefined, 'c', 'l', 's', undefined, 'sao')).toContain('sao.ata_sailed');
  });

  it('a cancelled member is the last choice for the primary row, ahead of every other rule', () => {
    const order = sqlShipmentListPrimaryOrderBy().replace(/\s+/g, ' ');
    const cancelledAt = order.indexOf("IN ('CANCELLED', 'CANCELED') THEN 1");
    expect(cancelledAt).toBeGreaterThanOrEqual(0);
    // before the STO type, the vessel name and created_at DESC, which is what used to pick the newest - cancelled - PO of a multi-PO shipment
    expect(cancelledAt).toBeLessThan(order.indexOf("= 'V' THEN 0"));
    expect(cancelledAt).toBeLessThan(order.lastIndexOf('created_at DESC')); // the clause, not the word in the SQL comment
    expect(sqlShipmentListPrimaryIdAgg()).toContain("IN ('CANCELLED', 'CANCELED') THEN 1");
    expect(sqlShipmentListPrimaryFieldAgg('s.vessel_name')).toContain("IN ('CANCELLED', 'CANCELED') THEN 1");
  });

  it('primary field agg uses the same ranking as primary id', () => {
    const idSql = sqlShipmentListPrimaryIdAgg('sto_key', 'c', 'l', 's', 'cs_sto');
    const nameSql = sqlShipmentListPrimaryFieldAgg(
      's.vessel_name',
      'sto_key',
      'c',
      'l',
      's',
      'cs_sto',
    );
    expect(nameSql).toContain('s.vessel_name');
    expect(nameSql).toContain("= 'V' THEN 0");
    expect(nameSql).toContain('s.created_at DESC');
    expect(nameSql).toContain('ata_discharge_complete IS NOT NULL');
    expect(idSql).toContain('array_agg(s.id');
  });
});

describe('a cancelled PO does not cancel a shipment that still has an active PO', () => {
  it('the group status ignores cancelled members while any member is not cancelled', () => {
    const sql = sqlShipmentGroupStatusAgg('s').replace(/\s+/g, ' ');
    expect(sql).toContain("MAX(s.status) FILTER (WHERE UPPER(TRIM(COALESCE(s.status, ''))) NOT IN ('CANCELLED', 'CANCELED'))");
    // ... and falls back to the plain MAX when every member is cancelled, so an all-cancelled shipment stays Cancelled
    expect(sql).toMatch(/^COALESCE\(.*, MAX\(s\.status\) \)$/);
  });

  it('uses the alias it is given', () => {
    expect(sqlShipmentGroupStatusAgg('sh')).toContain('MAX(sh.status)');
    expect(sqlShipmentGroupStatusAgg('sh')).not.toContain('s.status,');
  });
});
