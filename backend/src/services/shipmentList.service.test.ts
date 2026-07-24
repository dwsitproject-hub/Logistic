import { describe, expect, it } from 'vitest';
import { normalizeShipmentListRows } from './shipmentList.service';

describe('normalizeShipmentListRows', () => {
  it('does not floor to SAILED when is_contract_sap_closed is TRUE (GR Close)', () => {
    const rows = normalizeShipmentListRows([
      {
        row_kind: 'shipment',
        sto_number: '1016010610',
        is_contract_sap_closed: true,
        group_status_floor: 'SAILED',
        group_active_status_count: 3,
        ata_vessel_sailed_from_loading_port: '2026-05-15',
        status: 'SAILED',
      },
    ] as Parameters<typeof normalizeShipmentListRows>[0]);
    expect(rows[0]?.status).toBe('COMPLETED');
  });

  it('still floors when GR is Open and members disagree', () => {
    const rows = normalizeShipmentListRows([
      {
        row_kind: 'shipment',
        sto_number: 'STO-MIX-1',
        is_contract_sap_closed: false,
        group_status_floor: 'UNPLANNED',
        group_active_status_count: 2,
        ata_vessel_sailed_from_loading_port: '2026-07-18',
        status: 'PLANNED',
      },
    ] as Parameters<typeof normalizeShipmentListRows>[0]);
    expect(rows[0]?.status).toBe('UNPLANNED');
  });
});
