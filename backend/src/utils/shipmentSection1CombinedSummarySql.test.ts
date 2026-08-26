import { describe, expect, it } from 'vitest';
import {
  buildShipmentSection1CombinedSummaryQuery,
  buildPipelineCardVesselNamesQuery,
  buildShipmentPipelineLiveStageCountsQuery,
  buildShipmentSummaryEtaEnrichmentSelect,
  overlayShipmentDailySummaryLiveStageCounts,
  parseShipmentStatusCardQtyExecutionFromCombinedSummaryRow,
} from './shipmentSection1CombinedSummarySql';

describe('shipmentSection1CombinedSummarySql', () => {
  it('buildShipmentSection1CombinedSummaryQuery uses qty_move without sto_metrics', () => {
    const sql = buildShipmentSection1CombinedSummaryQuery({
      shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1)',
      unplannedBacklogCountCteSql: ', unplanned_contract_backlog_table AS (SELECT 0 AS backlog_count)',
      toolbarOuterSql: '',
      summaryScopeCte: '',
      summaryEnrichedFrom: 'filtered_shipments',
    });
    expect(sql).not.toContain('LEFT JOIN sto_metrics sm ON TRIM(sm.sto_key');
    expect(sql).not.toContain('sap_agg sa');
    expect(sql).not.toContain('po_sto_count');
    expect(sql).toContain('qty_move');
    expect(sql).toContain('unplanned_execution_contract_qty');
    expect(sql).toContain('unplanned_execution_outstanding_qty');
    expect(sql).toContain('0::numeric AS unplanned_execution_outstanding_qty');
    expect(sql).toContain('planned_outstanding_qty');
    expect(sql).toContain('execution_os');
    expect(sql).toContain('DISTINCT ON (contract_number)');
    expect(sql).toContain('at_loading_port_outstanding_qty');
    expect(sql).toContain('planned_count');
    expect(sql).toContain('loading_no_eta');
    expect(sql).toContain('vessel_name_master');
    expect(sql).toContain('vessel_name_sap');
    expect(sql).toContain('contract_source_type');
  });

  it('buildPipelineCardVesselNamesQuery uses master + SAP display vessel key and live stage counts', () => {
    const sql = buildPipelineCardVesselNamesQuery({
      shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1)',
      unplannedBacklogCountCteSql: ', unplanned_contract_backlog_table AS (SELECT 0 AS backlog_count)',
      toolbarOuterSql: '',
      summaryScopeCte: '',
      summaryEnrichedFrom: 'filtered_shipments',
    });
    expect(sql).toContain('unplanned_vessel_names');
    expect(sql).toContain('vessel_name_master');
    expect(sql).toContain('planned_count');
    expect(sql).toContain('sailed_count');
    expect(sql).toContain('at_discharge_port_count');
    expect(sql).toContain('completed_count');
    expect(sql).not.toContain('total_count');
  });

  it('buildShipmentPipelineLiveStageCountsQuery includes live vessel names without SPD qty joins', () => {
    const sql = buildShipmentPipelineLiveStageCountsQuery({
      shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1 AS id)',
      toolbarOuterSql: " AND sb.plant_site = 'X'",
    });
    expect(sql).toContain('at_loading_port_count');
    expect(sql).toContain('planned_count');
    expect(sql).toContain('total_count');
    expect(sql).toContain("sb.plant_site = 'X'");
    expect(sql).toContain('at_loading_port_vessel_names');
    expect(sql).toContain('vessel_name_master');
    expect(sql).toContain('is_contract_sap_closed');
    expect(sql).not.toContain('sto_metrics');
    expect(sql).not.toContain('outstanding_quantity');
  });

  it('overlayShipmentDailySummaryLiveStageCounts patches stage counts and live vessel names', () => {
    const merged = overlayShipmentDailySummaryLiveStageCounts(
      {
        planned_count: 10,
        at_loading_port_count: 0,
        sailed_count: 2,
        at_loading_port_vessel_names: ['OLD'],
        planned_vessel_names: ['DAILY PLANNED'],
        eta_loading_delay: 5,
      },
      {
        planned_count: 9,
        at_loading_port_count: 1,
        sailed_count: 2,
        total_count: 100,
        loading_port_arrived_count: 1,
        at_loading_port_vessel_names: ['LIVE A', 'LIVE B'],
        planned_vessel_names: [],
      },
    );
    expect(merged.at_loading_port_count).toBe(1);
    expect(merged.planned_count).toBe(9);
    expect(merged.total_count).toBe(100);
    expect(merged.loading_port_arrived_count).toBe(1);
    expect(merged.at_loading_port_vessel_names).toEqual(['LIVE A', 'LIVE B']);
    expect(merged.planned_vessel_names).toEqual([]);
    expect(merged.eta_loading_delay).toBe(5);
  });

  it('defines a shipment_page CTE so qty_move can scope contracts without sto_metrics', () => {
    const sql = buildShipmentSection1CombinedSummaryQuery({
      shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1)',
      unplannedBacklogCountCteSql: ', unplanned_contract_backlog_table AS (SELECT 0 AS backlog_count)',
      toolbarOuterSql: '',
      summaryScopeCte: '',
      summaryEnrichedFrom: 'filtered_shipments',
    });
    expect(sql).toContain('shipment_page AS (');
    expect(sql).toContain('SELECT * FROM filtered_shipments');
    // shipment_page must be defined before it is first referenced downstream.
    expect(sql.indexOf('shipment_page AS (')).toBeLessThan(sql.indexOf('FROM shipment_page sp'));
    expect(sql).not.toContain('LEFT JOIN sto_metrics sm ON TRIM(sm.sto_key');
    expect(sql).not.toContain('po_sto_count');
  });

  it('aliases shipment_page to the scoped source when Section 1 stage scope is active', () => {
    const sql = buildShipmentSection1CombinedSummaryQuery({
      shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1)',
      unplannedBacklogCountCteSql: ', unplanned_contract_backlog_table AS (SELECT 0 AS backlog_count)',
      toolbarOuterSql: '',
      summaryScopeCte: ", scoped_shipments AS (SELECT sb.* FROM filtered_shipments sb WHERE 1=1)",
      summaryEnrichedFrom: 'scoped_shipments',
    });
    expect(sql).toContain('shipment_page AS (\n        SELECT * FROM scoped_shipments\n      )');
  });

  it('parseShipmentStatusCardQtyExecutionFromCombinedSummaryRow maps combined row', () => {
    const parsed = parseShipmentStatusCardQtyExecutionFromCombinedSummaryRow({
      unplanned_execution_contract_qty: '1000',
      planned_contract_qty: 2000,
      completed_contract_qty: '500',
      cancelled_contract_qty: null,
      unplanned_execution_outstanding_qty: '400',
      planned_outstanding_qty: '500',
      at_loading_port_outstanding_qty: '300',
      sailed_outstanding_qty: 100,
      at_discharge_port_outstanding_qty: '200',
    });
    expect(parsed.statusContractQty.planned).toBe(2000);
    expect(parsed.statusContractQty.unplanned).toBe(0);
    expect(parsed.statusOutstandingQty.unplanned).toBe(0);
    expect(parsed.statusOutstandingQty.planned).toBe(500);
    expect(parsed.statusOutstandingQty.atLoadingPort).toBe(300);
  });

  it('buildShipmentSummaryEtaEnrichmentSelect includes effective_status', () => {
    expect(buildShipmentSummaryEtaEnrichmentSelect('f')).toContain('effective_status');
    expect(buildShipmentSummaryEtaEnrichmentSelect('f')).toContain('loading_no_eta');
  });
});
