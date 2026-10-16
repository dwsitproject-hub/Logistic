import { describe, expect, it } from 'vitest';
import { buildOilLossGainSql, buildOilLossMainSql } from './oilLossQuerySql';
import {
  buildOilLossVesselCompletedCtes,
  sqlOilLossVesselMemberStatus,
} from './oilLossVesselCompletedSql';
import { sqlIsContractSapClosedForStoExpr } from './contractDeliveryStatus';
import { contractsOnStoSubquery } from './stoLinkedContractSql';
import { shipmentEffectiveStatusExpr, shipmentListContractOsWithinBandExpr } from './shipmentListFilters';
import { deriveShipmentStatus } from './shipmentStatus';
import { shipmentListSeaStoKeyExpr } from './shipmentStoTypeSql';
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

  it('leaves SFAL and SFBD off trucking rows', async () => {
    const sql = await buildOilLossMainSql();
    expect(sql).toContain('NULL::numeric AS quantity_sfal');
    expect(sql).toContain('NULL::numeric AS quantity_sfbd');
    expect(sql).not.toContain('trucking_sfal_kg, NULLIF(shipment_sfal_kg, 0)');
  });
});

function collapseSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('vessel completed population', () => {
  it('keeps one STO that is Completed the way the Shipments page decides it: GR Close, else ATC, else OS inside the zero band', () => {
    const sql = buildOilLossVesselCompletedCtes();
    const flat = collapseSql(sql);
    const stoKey = shipmentListSeaStoKeyExpr('c', 'l', 's');
    // members: every shipment of the STO that is not Cancelled - the stored status of a row is not the rule
    expect(flat).toContain(collapseSql(sqlOilLossVesselMemberStatus('s')));
    expect(flat).not.toContain("UPPER(TRIM(COALESCE(s.status, ''))) = 'COMPLETED'");
    expect(flat).toContain(collapseSql(stoKey));
    // the STO is Completed when every contract is GR Close, or its own ATC is filled, or every contract's OS is inside the band
    expect(flat).toContain(collapseSql(sqlIsContractSapClosedForStoExpr('c', stoKey)));
    expect(flat).toContain(collapseSql(shipmentListContractOsWithinBandExpr()));
    expect(flat).toContain('ata_discharge_complete');
    expect(flat).toContain('COALESCE(f.is_gr_closed, FALSE) OR f.atc_own_sto IS NOT NULL OR COALESCE(f.is_os_within_band, FALSE)');
    // the POs are the ones the Shipments View Table lists for the STO, not only those of Completed rows
    expect(flat).toContain(collapseSql(contractsOnStoSubquery("NULLIF(TRIM(g.sto_key::text), '')")));
    expect(flat).toContain('contract_qty_move_snapshot');
    expect(flat).toContain('FROM vessel_sto_contract vsc');
    // a Cancelled contract linked through SAP is listed by Shipments but its quantity is not the voyage's
    expect(flat).toContain("UPPER(TRIM(COALESCE(c2.status, ''))) NOT IN ('CANCELLED', 'CANCELED')");
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain("IN ('CIF', 'FOB', 'CFR')");
    expect(sql).toContain("= 'PRESENT'");
    expect(sql).not.toContain('oil_loss_closed');
    expect(sql).not.toContain('qty_receive_resolved < qty_delivery_resolved');
    expect(sql).toContain('NULLIF(s.sfal_qty, 0)');
    expect(sql).toContain('NULLIF(s.sfbd_qty, 0)');
    expect(sql).toContain('g.shipment_sfal_kg AS quantity_sfal');
    expect(sql).not.toContain("NULLIF(TRIM((NULLIF(s.sfal_qty, 0))::text), '') IS NOT NULL");
    expect(sql).not.toContain("NULLIF(TRIM((NULLIF(s.sfbd_qty, 0))::text), '') IS NOT NULL");
    expect(sql).not.toContain('SUM(quantity_sfal)');
    expect(sql).not.toContain('SUM(quantity_sfbd)');
    expect(sql).toContain('/ 100');
    expect(sql).not.toContain('qty_sfal_raw');
    expect(sql).not.toContain('spd_fig');
    expect(sql).not.toContain('actual_vessel_qty_receive');
    expect(sql).not.toContain('vlp_load_first');
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
