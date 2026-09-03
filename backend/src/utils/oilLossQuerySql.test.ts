import { describe, expect, it } from 'vitest';
import { buildOilLossGainSql, buildOilLossMainSql } from './oilLossQuerySql';
import {
  SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC,
  SAP_OIL_LOSS_QTY_VESSEL_NUMERIC,
  sqlOilLossUatQtyDeliveryExpr,
} from './oilLossSapSql';

describe('buildOilLossMainSql', () => {
  it('resolves qty from Contracts qty_move (same as Contracts View Table)', () => {
    const sql = buildOilLossMainSql();
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
    expect(sql).toContain('quantity_delivery_trucking');
    expect(sql).toContain('quantity_delivery_vessel');
  });

  it('resolves SFAL/SFBD via SAP then trucking then non-zero shipment', () => {
    const sql = buildOilLossMainSql();
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

describe('operation_id derivation (SEA voyage / LAND trucking op id, with fallback)', () => {
  it('prefers shipment/trucking Operation ID over the legacy Contract Ext No fallback', () => {
    const sql = buildOilLossMainSql();
    expect(sql).toContain('operation_id_sap_fallback');
    expect(sql).toContain('sh_sto.operation_id');
    expect(sql).toContain('sh_sto.sto_key');
    expect(sql).toContain('sh_ct.operation_id');
    expect(sql).toContain('tr_sto.operation_id');
    expect(sql).toContain('tr_ct.operation_id');
    // Final fallback is still the pre-existing SAP Contract Ext No value, so rows with no
    // shipment/trucking match never lose their operation_id.
    expect(sql).toContain("NULLIF(TRIM(p.operation_id_sap_fallback), '')");
  });

  it('selects operation_id from shipments and trucking lookup CTEs', () => {
    const sql = buildOilLossMainSql();
    expect(sql).toContain('NULLIF(TRIM(operation_id), \'\') AS operation_id');
  });
});

describe('buildOilLossGainSql', () => {
  it('uses UAT delivery and incoterm-aware close filter', () => {
    const sql = buildOilLossGainSql();
    expect(sql).toContain('with_delivery');
    expect(sql).toContain('import_status');
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

  it('casts SAP qty only when the cleaned cell is a single number', () => {
    const sql = buildOilLossMainSql();
    expect(SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC).toContain('^-?[0-9]+');
    expect(SAP_OIL_LOSS_QTY_TRUCKING_NUMERIC).toContain('ELSE NULL');
    expect(sql).toContain('^-?[0-9]+');
    expect(sql).not.toContain('^[0-9.]+$');
  });
});
