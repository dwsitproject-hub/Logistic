import { describe, expect, it } from 'vitest';
import { buildOilLossGainSql, buildOilLossMainSql } from './oilLossQuerySql';
import {
  buildOilLossVesselCompletedCtes,
  sqlOilLossVesselCompletedStatus,
} from './oilLossVesselCompletedSql';
import { shipmentEffectiveStatusExpr } from './shipmentListFilters';
import { deriveShipmentStatus } from './shipmentStatus';
import {
  SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC,
  SAP_OIL_LOSS_QTY_VESSEL_NUMERIC,
  sqlOilLossUatQtyDeliveryExpr,
} from './oilLossSapSql';

describe('buildOilLossMainSql', () => {
  it('resolves qty from Contracts qty_move (same as Contracts View Table)', async () => {
    const sql = await buildOilLossMainSql();
    expect(sql).toContain('oil_loss_closed');
    expect(sql).toContain('oil_loss_eligible');
    expect(sql).toContain('oil_loss_contract_scope');
    expect(sql).toContain('qty_move');
    expect(sql).toContain('qty_delivery_resolved');
    expect(sql).toContain('qty_receive_resolved');
    expect(sql).toContain('qty_receive_resolved < qty_delivery_resolved');
    expect(sql).toContain('b2b_end');
    expect(sql).toContain('Truck Discharge Location');
    expect(sql).toContain('Discharge Destination');
    expect(sql).toContain('b2b_ending_buyer');
    expect(sql).not.toContain('plants_by_code');
    expect(sql).not.toContain('master_plants');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR') THEN 'SEA'");
    expect(sql).not.toContain("NULLIF(TRIM(oil_loss_eligible.transport_mode)");
    expect(sql).toContain('quantity_delivery_trucking');
    expect(sql).toContain('quantity_delivery_vessel');
  });

  it('resolves SFAL/SFBD via SAP then trucking then non-zero shipment', async () => {
    const sql = await buildOilLossMainSql();
    expect(sql).toContain('trucking_sfal_kg');
    expect(sql).toContain('trucking_sfbd_kg');
    expect(sql).toContain('NULLIF(shipment_sfal_kg, 0)');
    expect(sql).toContain('NULLIF(shipment_sfbd_kg, 0)');
    expect(sql).toContain('sfal_qty');
    expect(sql).toContain('sfbd_qty');
    expect(sql).toContain(
      'COALESCE(qty_sfal_raw, trucking_sfal_kg, NULLIF(shipment_sfal_kg, 0))',
    );
    expect(sql).toContain(
      'COALESCE(qty_sfbd_raw, trucking_sfbd_kg, NULLIF(shipment_sfbd_kg, 0))',
    );
  });
});

function collapseSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('vessel completed population', () => {
  it('keeps one STO using the Shipments Completed status', () => {
    const sql = buildOilLossVesselCompletedCtes();
    const flat = collapseSql(sql);
    expect(flat).toContain(collapseSql(sqlOilLossVesselCompletedStatus('f')));
    expect(flat).toContain(collapseSql(shipmentEffectiveStatusExpr('f')));
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).toContain("= 'PRESENT'");
    expect(sql).not.toContain('oil_loss_closed');
    expect(sql).not.toContain('qty_receive_resolved < qty_delivery_resolved');
  });

  it('leaves the loss filter on the trucking branch only', async () => {
    const sql = await buildOilLossMainSql();
    expect(sql).toContain('oil_loss_closed');
    expect(sql).toContain('qty_receive_resolved < qty_delivery_resolved');
    expect(sql).toContain('vessel_rows');
    expect(sql).toContain('trucking_rows');
    expect(sql).toContain("IN ('FRC', 'LCO')");
  });

  it('treats ATA complete discharge as Completed while the contract is still Open', () => {
    expect(
      deriveShipmentStatus({
        contract_import_status: 'Open',
        ata_complete_discharge: '2026-06-01',
      }),
    ).toBe('COMPLETED');
  });

  it('keeps completed loading and an open contract without ATC out of Completed', () => {
    expect(
      deriveShipmentStatus({
        contract_import_status: 'Open',
        ata_completed_loading: '2026-06-01',
      }),
    ).toBe('COMPLETED_LOADING');
    expect(deriveShipmentStatus({ contract_import_status: 'Open' })).toBe('PLANNED');
  });

  it('excludes Cancelled and does not promote COMPLETED_LOADING through the status expression', () => {
    const expr = shipmentEffectiveStatusExpr('f');
    expect(expr).toMatch(/'CANCELLED' THEN 'CANCELLED'/);
    expect(expr).toContain('is_contract_os_within_band');
    expect(expr).toContain('is_contract_sap_closed');
    expect(expr).toContain('ata_vessel_complete_discharge');
    const completed = expr.indexOf("THEN 'COMPLETED'");
    const loading = expr.indexOf("THEN 'COMPLETED_LOADING'");
    expect(completed).toBeGreaterThan(-1);
    expect(loading).toBeGreaterThan(completed);
  });
});

describe('operation_id derivation (shipment voyage id only)', () => {
  it('uses the shipment Operation ID and does not fall back to STO or Contract Ext No', async () => {
    const sql = await buildOilLossMainSql();
    expect(sql).toContain('sh_sto.operation_id');
    expect(sql).toContain('sh_ct.operation_id');
    expect(sql).not.toContain('sh_sto.sto_key,');
    expect(sql).not.toContain("NULLIF(TRIM(p.operation_id_sap_fallback), '')");
  });

  it('selects operation_id from shipments and trucking lookup CTEs', async () => {
    const sql = await buildOilLossMainSql();
    expect(sql).toContain('NULLIF(TRIM(operation_id), \'\') AS operation_id');
  });
});

describe('buildOilLossGainSql', () => {
  it('uses UAT delivery and incoterm-aware close filter', () => {
    const sql = buildOilLossGainSql();
    expect(sql).toContain('with_delivery');
    expect(sql).toContain('import_status');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR') THEN 'SEA'");
    expect(sql).not.toContain('SEA / LAND');
  });
});

describe('sqlOilLossUatQtyDeliveryExpr', () => {
  it('prefers UAT matrix over legacy delivery', () => {
    const expr = sqlOilLossUatQtyDeliveryExpr({
      incotermExpr: 'inc',
      transportExpr: 'tm',
      truckingCol: 'qt',
      vesselCol: 'qv',
      legacyCol: 'ql',
    });
    expect(expr).toContain('WHEN COALESCE');
    expect(expr).toContain('ELSE COALESCE(ql, 0)');
  });
});

describe('oilLossSapSql UAT fields', () => {
  it('includes trucking and vessel SAP raw paths', () => {
    expect(SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC).toContain('Quantity Delivery Trucking');
    expect(SAP_OIL_LOSS_QTY_VESSEL_NUMERIC).toContain('Quantity Delivery Vessel');
  });

  it('casts SAP qty only when the cleaned cell is a single number', async () => {
    const sql = await buildOilLossMainSql();
    expect(SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC).toContain('^-?[0-9]+');
    expect(SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC).toContain('ELSE NULL');
    expect(sql).toContain('^-?[0-9]+');
    expect(sql).not.toContain('^[0-9.]+$');
  });
});
