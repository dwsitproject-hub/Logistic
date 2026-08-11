import { describe, expect, it } from 'vitest';
import {
  appendShipmentPipelineStageFilter,
  buildShipmentPageUnplannedOpenContractsCte,
  normalizeShipmentPagePipelineStageParam,
  shipmentHasAnyDischargePortAtaExpr,
  shipmentHasAnyLoadingPortAtaExpr,
  shipmentPagePipelineStageExpr,
  shipmentPagePipelineUnplannedRowPredicate,
  shipmentPipelineDisplayVesselKeyExpr,
  shipmentPipelineEnrichedDisplayVesselKeyExpr,
} from './shipmentPagePipelineSql';

describe('shipmentPagePipelineSql', () => {
  it('maps legacy status keys to pipeline stages', () => {
    expect(normalizeShipmentPagePipelineStageParam('IN_PROGRESS')).toBe('AT_LOADING_PORT');
    expect(normalizeShipmentPagePipelineStageParam('IN_TRANSIT')).toBe('SAILED');
    expect(normalizeShipmentPagePipelineStageParam('UNLOADING')).toBe('AT_DISCHARGE_PORT');
    expect(normalizeShipmentPagePipelineStageParam('PLANNED')).toBe('PLANNED');
  });

  it('builds mutually exclusive pipeline stage expression', () => {
    const sql = shipmentPagePipelineStageExpr('sb');
    expect(sql).toContain('AT_LOADING_PORT');
    expect(sql).toContain('AT_DISCHARGE_PORT');
    expect(sql).toContain('SAILED');
    expect(sql).toContain('PLANNED');
    expect(sql).toContain('COMPLETED');
    expect(sql).toContain('CANCELLED');
  });

  it('uses loading and discharge ATA helpers', () => {
    expect(shipmentHasAnyLoadingPortAtaExpr('f')).toContain('ata_vessel_arrival_at_loading_port');
    expect(shipmentHasAnyDischargePortAtaExpr('f')).toContain('ata_vessel_start_discharging');
  });

  it('filters unplanned rows without ETA, ATA, or Delivery Qty', () => {
    const sql = shipmentPagePipelineUnplannedRowPredicate('sb');
    expect(sql).toContain('is_contract_sap_closed');
    expect(sql).toContain('eta_arrival');
    expect(sql).toContain('quantity_delivered');
    expect(sql).toContain('quantity_delivered_klip');
  });

  it('builds stage filter SQL for pipeline and unplanned', () => {
    const planned = appendShipmentPipelineStageFilter('PLANNED', 3);
    expect(planned.sql).toContain('= $3');
    expect(planned.params).toEqual(['PLANNED']);

    const atLoading = appendShipmentPipelineStageFilter('AT_LOADING_PORT', 3);
    expect(atLoading.sql).toContain('IN ($3, $4');
    expect(atLoading.params).toEqual(['ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING']);

    const sailed = appendShipmentPipelineStageFilter('SAILED', 5);
    expect(sailed.sql).toContain('= $5');
    expect(sailed.params).toEqual(['SAILED']);

    const unplanned = appendShipmentPipelineStageFilter('UNPLANNED', 3);
    expect(unplanned.sql).toContain('is_contract_sap_closed');
    expect(unplanned.sql).toContain("'CIF'");
    expect(unplanned.sql).toContain("'FOB'");
    expect(unplanned.sql).toContain("'CFR'");
    expect(unplanned.params).toEqual([]);
  });

  it('builds display vessel key from master, SAP, and KLIP fallbacks', () => {
    const key = shipmentPipelineDisplayVesselKeyExpr(
      'mv.vessel_name_master',
      'sl.vessel_name_sap',
      's.vessel_name',
    );
    expect(key).toContain('mv.vessel_name_master');
    expect(key).toContain('sl.vessel_name_sap');
    expect(key).toContain('s.vessel_name');
    expect(shipmentPipelineEnrichedDisplayVesselKeyExpr('e')).toContain('e.vessel_name_master');
  });

  it('limits unplanned open-contracts CTE to CIF/FOB/CFR', () => {
    const cte = buildShipmentPageUnplannedOpenContractsCte();
    expect(cte).toContain("'CIF'");
    expect(cte).toContain("'FOB'");
    expect(cte).toContain("'CFR'");
  });
});
