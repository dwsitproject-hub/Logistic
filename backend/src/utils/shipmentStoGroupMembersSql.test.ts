import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  shipmentStoKeyWithoutSpdExpr,
  sqlShipmentOrStoKeyMatchWhere,
  sqlStoGroupMemberIdsForShipment,
} from './shipmentStoGroupMembersSql';
import { SHIPMENT_LIST_SAP_PORTS_AGG_CTES } from './shipmentListPortsSql';

describe('shipmentStoGroupMembersSql', () => {
  it('derives sto_key from operation_id when sto_number is empty (OP-* manual operations)', () => {
    const sql = shipmentStoKeyWithoutSpdExpr('c', 's');
    expect(sql).toContain('s.operation_id');
    expect(sql).not.toContain('effective_sto');
  });

  it('matches siblings by shared sto_key including operation_id', () => {
    const sql = sqlStoGroupMemberIdsForShipment();
    expect(sql).toContain('WITH anchor AS');
    expect(sql).toContain("COALESCE(s.status, '') <> 'CANCELLED'");
    expect(sql).toContain('= anchor.sto_key');
    expect(sql).toContain('ORDER BY c.contract_id');
  });

  it('non-UUID loading-ports lookup matches operation_id and sto_key', () => {
    const where = sqlShipmentOrStoKeyMatchWhere('$1', 'c', 's');
    expect(where).toContain('c.sto_number = $1');
    expect(where).toContain('s.shipment_id = $1');
    expect(where).toContain('s.operation_id');
  });
});

describe('multi-contract OP-* loading ports (regression)', () => {
  it('list SAP agg unions Vessel Loading Port across spd_keyed rows per sto_key', () => {
    expect(SHIPMENT_LIST_SAP_PORTS_AGG_CTES).toContain("'Vessel Loading Port 2'");
    expect(SHIPMENT_LIST_SAP_PORTS_AGG_CTES).toContain('STRING_AGG(DISTINCT port_name');
  });

  it('getVesselLoadingPorts expands UUID requests to STO group members', () => {
    const src = readFileSync(
      resolve(__dirname, '../controllers/shipment.controller.ts'),
      'utf8',
    );
    expect(src).toContain('resolveStoGroupShipmentIds');
    expect(src).toContain('vlp.shipment_id = ANY($1::uuid[])');
    expect(src).toContain('sqlShipmentOrStoKeyMatchWhere');
  });
});
