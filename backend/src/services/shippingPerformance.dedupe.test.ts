import { describe, expect, it } from 'vitest';
import {
  aggregateShippingPerformanceRowsBySto,
  deriveShippingPerfRowStatus,
  mergeShippingPerfStoGroup,
  shippingPerfStoGroupKey,
} from '../services/shippingPerformance.service';

describe('deriveShippingPerfRowStatus', () => {
  it('matches Shipments: GR Close → COMPLETED even when DB status is PLANNED', () => {
    expect(
      deriveShippingPerfRowStatus({
        status: 'PLANNED',
        import_status: 'Close',
        loading_eta_arrival: '2026-07-14',
      }),
    ).toBe('COMPLETED');
  });

  it('matches Shipments: ATA discharge complete → COMPLETED', () => {
    expect(
      deriveShippingPerfRowStatus({
        status: 'PLANNED',
        import_status: 'Open',
        discharge_ata_completed: '2026-07-20',
      }),
    ).toBe('COMPLETED');
  });

  it('matches Shipments: ATA sailed → SAILED', () => {
    expect(
      deriveShippingPerfRowStatus({
        status: 'PLANNED',
        import_status: 'Open',
        loading_ata_sailed: '2026-07-18',
      }),
    ).toBe('SAILED');
  });

  it('preserves CANCELLED', () => {
    expect(
      deriveShippingPerfRowStatus({
        status: 'CANCELLED',
        import_status: 'Close',
        discharge_ata_completed: '2026-07-20',
      }),
    ).toBe('CANCELLED');
  });

  it('ETA without ATA → PLANNED', () => {
    expect(
      deriveShippingPerfRowStatus({
        status: 'UNPLANNED',
        import_status: 'Open',
        loading_eta_arrival: '2026-07-14',
      }),
    ).toBe('PLANNED');
  });
});

describe('aggregateShippingPerformanceRowsBySto', () => {
  it('collapses multiple PO rows on the same STO with per-PO outstanding sums', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        shipment_id: '1646000083',
        sto_number: '1646000083',
        po_number: '1641000216',
        contract_number: '1004030411',
        contract_qty: 800_000,
        sto_qty: 500_000,
        received_qty: 200_000,
        delivered_qty: 0,
        planning_qty: 100_000,
        incoterm: 'CIF',
        vessel_name: 'BG GLORY 7',
      },
      {
        id: 'b',
        shipment_id: '1646000083',
        sto_number: '1646000083',
        po_number: '1641000217',
        contract_number: '1004030412',
        contract_qty: 800_000,
        sto_qty: 500_000,
        received_qty: 200_000,
        delivered_qty: 0,
        planning_qty: 50_000,
        incoterm: 'CIF',
        vessel_name: 'BG GLORY 7',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(shippingPerfStoGroupKey(rows[0]!)).toBe('sto:1646000083');
    expect(rows[0]?.contract_qty).toBe(1_600_000);
    expect(rows[0]?.sto_qty).toBe(1_000_000);
    expect(rows[0]?.received_qty).toBe(400_000);
    expect(rows[0]?.outstanding_qty_actual).toBe(1_200_000);
    expect(rows[0]?.outstanding_qty_planning).toBe(450_000);
  });

  it('groups unplanned rows by SQL sto_key (SAP STO) when shipment_id differs', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        shipment_id: '1006017437',
        sto_number: '1006017941',
        sto_key: '1006017941',
        po_numbers: '1001027917, 1001028042',
        contract_qty: 3_750_000,
        received_qty: 3_000_000,
        delivered_qty: 3_000_000,
        outstanding_qty_actual: 750_000,
        vessel_name: 'TEST VESSEL',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(shippingPerfStoGroupKey(rows[0]!)).toBe('sto:1006017941');
    expect(rows[0]?.contract_qty).toBe(3_750_000);
  });

  it('uses sto_metrics join fields when present', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        shipment_id: '1646000083',
        po_numbers: '1641000216, 1641000217',
        contract_numbers: '1004030411, 1004030412',
        contract_qty: 1_600_000,
        sto_qty: 1_000_000,
        received_qty: 400_000,
        outstanding_qty_actual: 1_200_000,
        outstanding_qty_planning: 450_000,
        planning_qty: 150_000,
        delivered_qty: 0,
      },
      {
        id: 'b',
        shipment_id: '1646000083',
        po_numbers: '1641000216, 1641000217',
        contract_numbers: '1004030411, 1004030412',
        contract_qty: 1_600_000,
        sto_qty: 1_000_000,
        received_qty: 400_000,
        outstanding_qty_actual: 1_200_000,
        outstanding_qty_planning: 450_000,
        planning_qty: 150_000,
        delivered_qty: 0,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contract_qty).toBe(1_600_000);
    expect(rows[0]?.po_number).toBe('1641000216, 1641000217');
  });

  it('joins distinct suppliers with commas when collapsing multi-PO operation rows', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        operation_id: 'OP-1004028834-01552127',
        shipment_id: 'MNL-02121754-1004028985',
        sto_key: 'OP-1004028834-01552127',
        po_number: '1001028985',
        contract_number: '1004028985',
        supplier: 'SUPPLIER ALPHA',
        contract_qty: 700_000,
        outstanding_qty_actual: 700_000,
      },
      {
        id: 'b',
        operation_id: 'OP-1004028834-01552127',
        shipment_id: 'MNL-02121754-1004028986',
        sto_key: 'OP-1004028834-01552127',
        po_number: '1001028986',
        contract_number: '1004028986',
        supplier: 'SUPPLIER BETA',
        contract_qty: 200_000,
        outstanding_qty_actual: 200_000,
      },
      {
        id: 'c',
        operation_id: 'OP-1004028834-01552127',
        shipment_id: 'MNL-02121754-1004029122',
        sto_key: 'OP-1004028834-01552127',
        po_number: '1001029122',
        contract_number: '1004029122',
        supplier: 'SUPPLIER ALPHA',
        contract_qty: 300_000,
        outstanding_qty_actual: 300_000,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.supplier).toBe('SUPPLIER ALPHA, SUPPLIER BETA');
  });

  it('MAX-merges ATA sailed across STO members → SAILED (not least-derived PLANNED)', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        shipment_id: '1011003137',
        sto_number: '1011003137',
        status: 'PLANNED',
        import_status: 'Open',
        loading_ata_sailed: '2026-07-18',
        contract_qty: 100,
      },
      {
        id: 'b',
        shipment_id: '1011003137',
        sto_number: '1011003137',
        status: 'PLANNED',
        import_status: 'Open',
        loading_eta_arrival: '2026-07-14',
        contract_qty: 50,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('SAILED');
    expect(rows[0]?.loading_ata_sailed).toBe('2026-07-18');
  });

  it('uses voyage ATA when members disagree on persisted DB status', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        shipment_id: 'STO-MIX-1',
        sto_number: 'STO-MIX-1',
        status: 'PLANNED',
        import_status: 'Open',
        loading_ata_sailed: '2026-07-18',
        contract_qty: 100,
      },
      {
        id: 'b',
        shipment_id: 'STO-MIX-1',
        sto_number: 'STO-MIX-1',
        status: 'UNPLANNED',
        import_status: 'Open',
        loading_ata_sailed: '2026-07-19',
        contract_qty: 50,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('SAILED');
  });

  it('does not floor when GR Close even with mixed persisted DB statuses (STO 1016010610 pattern)', () => {
    const members = [
      {
        id: 'a',
        shipment_id: '1016010610',
        sto_number: '1016010610',
        sto_key: '1016010610',
        status: 'COMPLETED',
        import_status: 'Close',
        loading_ata_sailed: '2026-05-15',
        contract_qty: 100,
      },
      {
        id: 'b',
        shipment_id: '1016010610',
        sto_number: '1016010610',
        sto_key: '1016010610',
        status: 'SAILED',
        import_status: 'Close',
        loading_ata_sailed: '2026-05-15',
        contract_qty: 50,
      },
      {
        id: 'c',
        shipment_id: 'MNL-79626063-1014002977',
        sto_number: '1016010610',
        sto_key: '1016010610',
        status: 'IN_TRANSIT',
        import_status: 'Close',
        loading_ata_sailed: '2026-05-15',
        contract_qty: 50,
      },
    ];
    const merged = mergeShippingPerfStoGroup(members);
    expect(merged.status).toBe('COMPLETED');
  });

  it('aggregates import_status from all members: all Close → COMPLETED even when pick row is PLANNED', () => {
    const merged = mergeShippingPerfStoGroup([
      {
        id: 'a',
        shipment_id: '1646000083',
        sto_number: '1646000083',
        status: 'PLANNED',
        import_status: 'Close',
        loading_eta_arrival: '2026-07-14',
        contract_qty: 100,
      },
      {
        id: 'b',
        shipment_id: '1646000083',
        sto_number: '1646000083',
        status: 'SAILED',
        import_status: 'Close',
        loading_ata_sailed: '2026-07-18',
        contract_qty: 50,
      },
    ]);
    expect(merged.import_status).toBe('Close');
    expect(merged.status).toBe('COMPLETED');
  });

  it('aggregates import_status: any Open member keeps group On Going', () => {
    const merged = mergeShippingPerfStoGroup([
      {
        id: 'a',
        shipment_id: '1646000099',
        sto_number: '1646000099',
        status: 'PLANNED',
        import_status: 'Open',
        loading_eta_arrival: '2026-07-14',
        contract_qty: 100,
      },
      {
        id: 'b',
        shipment_id: '1646000099',
        sto_number: '1646000099',
        status: 'SAILED',
        import_status: 'Close',
        loading_ata_sailed: '2026-07-18',
        contract_qty: 50,
      },
    ]);
    expect(merged.import_status).toBe('Open');
    expect(merged.status).toBe('SAILED');
  });

  it('override-only loading_ata_sailed on a single row → SAILED', () => {
    const rows = aggregateShippingPerformanceRowsBySto([
      {
        id: 'a',
        shipment_id: '1011003137',
        sto_number: '1011003137',
        status: 'PLANNED',
        import_status: 'Open',
        loading_ata_sailed: '2026-07-18',
        loading_eta_arrival: '2026-07-14',
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('SAILED');
  });

  it('recomputes ATA loading deltas after MAX-merging milestones across STO members', () => {
    const merged = mergeShippingPerfStoGroup([
      {
        id: 'a',
        shipment_id: 'STO-DELTA-1',
        sto_number: 'STO-DELTA-1',
        status: 'COMPLETED',
        cargo_readiness_date: '2026-01-01',
        loading_ata_arrival: '2026-01-10',
        loading_ata_berthed: '2026-01-11',
        ata_loading_delta_eta_etr_days: 999,
        ata_loading_delta_eta_etb_days: 999,
      },
      {
        id: 'b',
        shipment_id: 'STO-DELTA-1',
        sto_number: 'STO-DELTA-1',
        status: 'COMPLETED',
        cargo_readiness_date: '2026-02-01',
        loading_ata_arrival: '2026-02-15',
        loading_ata_berthed: '2026-02-16',
        ata_loading_delta_eta_etr_days: 888,
        ata_loading_delta_eta_etb_days: 888,
      },
    ]);

    expect(merged.loading_ata_arrival).toBe('2026-02-15');
    expect(merged.loading_ata_berthed).toBe('2026-02-16');
    expect(merged.cargo_readiness_date).toBe('2026-02-01');
    expect(merged.ata_loading_delta_eta_etr_days).toBe(14);
    expect(merged.ata_loading_delta_eta_etb_days).toBe(-1);
  });

  it('keeps remarks_count from the keeper row', () => {
    const merged = mergeShippingPerfStoGroup([
      {
        id: 'other',
        shipment_id: 'MNL-1',
        sto_number: 'STO-R1',
        remarks_count: 0,
        contract_qty: 50,
      },
      {
        id: 'keeper',
        shipment_id: '1646000001',
        sto_number: 'STO-R1',
        remarks_count: 4,
        contract_qty: 100,
      },
    ]);
    expect(merged.id).toBe('keeper');
    expect(merged.remarks_count).toBe(4);
  });

  it('keeps the max po_sto_count so sibling STO OS is not triple-counted in KPIs', () => {
    const merged = mergeShippingPerfStoGroup([
      {
        id: 'a',
        shipment_id: '1586004927',
        sto_number: '1586004927',
        po_sto_count: 3,
        outstanding_qty_actual: 40_000,
        contract_qty: 100,
      },
      {
        id: 'b',
        shipment_id: '1586004928',
        sto_number: '1586004928',
        po_sto_count: 1,
        outstanding_qty_actual: 40_000,
        contract_qty: 50,
      },
    ]);
    expect(merged.po_sto_count).toBe(3);
  });
});
