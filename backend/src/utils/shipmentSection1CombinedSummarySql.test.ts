import { describe, expect, it } from 'vitest';
import {
  buildShipmentSection1CombinedSummaryQuery,
  buildPipelineCardVesselNamesQuery,
  buildShipmentSummaryEtaEnrichmentSelect,
  parseShipmentStatusCardQtyExecutionFromCombinedSummaryRow,
} from './shipmentSection1CombinedSummarySql';

describe('shipmentSection1CombinedSummarySql', () => {
  it('buildShipmentSection1CombinedSummaryQuery joins SPD once and includes qty columns', () => {
    const sql = buildShipmentSection1CombinedSummaryQuery({
      shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1)',
      unplannedBacklogCountCteSql: ', unplanned_contract_backlog_table AS (SELECT 0 AS backlog_count)',
      toolbarOuterSql: '',
      summaryScopeCte: '',
      summaryEnrichedFrom: 'filtered_shipments',
    });
    expect(sql).toContain('sto_metrics sm');
    expect(sql).toContain('sap_agg sa');
    expect(sql).toContain('unplanned_execution_contract_qty');
    expect(sql).toContain('at_loading_port_outstanding_qty');
    expect(sql).toContain('planned_count');
    expect(sql).toContain('loading_no_eta');
    expect(sql.match(/LEFT JOIN sto_metrics sm/g)?.length).toBe(1);
    expect(sql).toContain('vessel_name_master');
    expect(sql).toContain('vessel_name_sap');
  });

  it('buildPipelineCardVesselNamesQuery uses master + SAP display vessel key', () => {
    const sql = buildPipelineCardVesselNamesQuery({
      shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1)',
      unplannedBacklogCountCteSql: ', unplanned_contract_backlog_table AS (SELECT 0 AS backlog_count)',
      toolbarOuterSql: '',
      summaryScopeCte: '',
      summaryEnrichedFrom: 'filtered_shipments',
    });
    expect(sql).toContain('unplanned_vessel_names');
    expect(sql).toContain('vessel_name_master');
    expect(sql).not.toContain('total_count');
  });

  it('defines a shipment_page CTE so the spliced-in SAP-agg CTEs (shipment_page_contracts, spd_keyed, perf_sto_keys) resolve', () => {
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
      at_loading_port_outstanding_qty: '300',
      sailed_outstanding_qty: 100,
      at_discharge_port_outstanding_qty: '200',
    });
    expect(parsed.statusContractQty.planned).toBe(2000);
    expect(parsed.statusContractQty.unplanned).toBe(1000);
    expect(parsed.statusOutstandingQty.atLoadingPort).toBe(300);
  });

  it('buildShipmentSummaryEtaEnrichmentSelect includes effective_status', () => {
    expect(buildShipmentSummaryEtaEnrichmentSelect('f')).toContain('effective_status');
    expect(buildShipmentSummaryEtaEnrichmentSelect('f')).toContain('loading_no_eta');
  });
});
