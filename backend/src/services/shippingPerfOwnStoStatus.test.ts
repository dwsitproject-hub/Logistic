import { describe, expect, it } from 'vitest';
import { mergeShippingPerfStoGroup } from './shippingPerformance.service';

/**
 * One finished voyage must not mark its whole STO group finished - for outstanding, at least.
 *
 * maxMergeMilestoneFields takes the MAX across the group, and a group can hold a shipment whose
 * own STO is a different one (39 of 887 groups on dev). Three contracts were dropped that way on
 * production - 1004029445 on STO 1006019867, 1004030359, 1004031792 - whose own shipments are
 * PLANNED with no discharge ATC at all while the merged row read COMPLETED. This page then never
 * counted their outstanding and Shipments did: the last 161 MT of a 31,832 MT gap.
 *
 * Shipments makes the same split - the list keeps the group-wide value, only the OS path reads
 * ata_vessel_complete_discharge_own_sto, and its comment names that exact STO.
 *
 * Dev cannot demonstrate it: the mechanism fires on 39 groups but none of them carry a milestone
 * that flips the derived status, so the effect is only visible on production. These cases build
 * the shape directly instead.
 */
const row = (over: Record<string, unknown>) => ({
  sto_key: '1006019867',
  shipment_id: '1006019867',
  contract_number: 'C1',
  status: 'PLANNED',
  ...over,
});

describe('os_status narrows the stage to the row own STO', () => {
  it('keeps the group stage COMPLETED and narrows os_status when a FOREIGN sto carried the ATC', () => {
    const merged = mergeShippingPerfStoGroup([
      row({ contract_number: 'C1' }),
      // Same group, different own STO, and it is the one that finished.
      row({
        contract_number: 'C2',
        shipment_id: 'MNL-99999999-C2',
        discharge_ata_completed: '2026-09-01',
      }),
    ]);
    // The table keeps showing the group's stage, as it always has.
    expect(String(merged.status).toUpperCase()).toBe('COMPLETED');
    // Outstanding and card membership read this one, and the group's own STO has not finished.
    expect(String(merged.os_status).toUpperCase()).not.toBe('COMPLETED');
  });

  it('leaves os_status equal to status when every row shares the group STO', () => {
    const merged = mergeShippingPerfStoGroup([
      row({ contract_number: 'C1', discharge_ata_completed: '2026-09-01' }),
      row({ contract_number: 'C2' }),
    ]);
    expect(String(merged.os_status)).toBe(String(merged.status));
    expect(String(merged.status).toUpperCase()).toBe('COMPLETED');
  });

  /*
   * A shipment with no STO of its own has no other group to belong to, so it stays counted -
   * the same exception buildShipmentListAtaSelectSql makes.
   */
  it('counts a row with no STO of its own as belonging to the group', () => {
    const merged = mergeShippingPerfStoGroup([
      row({ contract_number: 'C1' }),
      row({ contract_number: 'C2', shipment_id: '', discharge_ata_completed: '2026-09-01' }),
    ]);
    expect(String(merged.os_status)).toBe(String(merged.status));
  });

  it('never invents a LATER stage than the group has', () => {
    const merged = mergeShippingPerfStoGroup([
      row({ contract_number: 'C1' }),
      row({ contract_number: 'C2', shipment_id: 'MNL-1-C2' }),
    ]);
    expect(String(merged.os_status)).toBe(String(merged.status));
  });
});

/**
 * A group keyed by an OPERATION id (sto_key 'OP-...') narrows only the discharge ATC, by Shipments' own test: a shipment is the group's own when
 * its id equals the key. SIT 2026-10-19: operation OP-1004030473-15277540 held four shipments PLANNED with ETC 6 Nov and one - the earlier
 * voyage of STO 1006019867, now cancelled - carrying an ATC of 15 Sep, and the whole row read COMPLETED (1,874 MT of OS dropped).
 */
describe('an operation-keyed group does not let a re-planned shipment inherit another voyage ATC', () => {
  const key = 'OP-1004030473-15277540';
  const member = (over: Record<string, unknown>) => ({
    sto_key: key,
    operation_id: key,
    shipment_id: 'MNL-15615718-1004030297',
    contract_number: '1004030297',
    status: 'PLANNED',
    ...over,
  });

  it('keeps the table status COMPLETED but reads the stage as not finished when only a foreign shipment carries the ATC', () => {
    const merged = mergeShippingPerfStoGroup([
      member({ contract_number: '1004030297' }),
      member({ contract_number: '1004030835', shipment_id: 'MNL-15615718-1004030835' }),
      member({ contract_number: '1004029908', shipment_id: '1006019867-1004029908', discharge_ata_completed: '2026-09-15' }),
    ]);
    expect(String(merged.status).toUpperCase()).toBe('COMPLETED');
    expect(String(merged.os_status).toUpperCase()).not.toBe('COMPLETED');
  });

  it('a shipment whose id IS the key still finishes the group', () => {
    const merged = mergeShippingPerfStoGroup([
      member({ shipment_id: key, discharge_ata_completed: '2026-09-15' }),
      member({ contract_number: '1004030835', shipment_id: 'MNL-15615718-1004030835' }),
    ]);
    expect(String(merged.status).toUpperCase()).toBe('COMPLETED');
    expect(String(merged.os_status)).toBe(String(merged.status));
  });

  it('keeps the other milestones of the voyage: a sailed group stays sailed, not planned', () => {
    const merged = mergeShippingPerfStoGroup([
      member({ loading_ata_sailed: '2026-09-10' }),
      member({ contract_number: '1004030835', shipment_id: 'MNL-15615718-1004030835', discharge_ata_completed: '2026-09-15' }),
    ]);
    expect(String(merged.os_status).toUpperCase()).not.toBe('COMPLETED');
    expect(String(merged.os_status).toUpperCase()).not.toBe('PLANNED');
  });

  it('does not touch a group when no shipment is foreign', () => {
    const merged = mergeShippingPerfStoGroup([
      member({ shipment_id: key, discharge_ata_completed: '2026-09-15' }),
      member({ contract_number: '1004030835', shipment_id: '' }),
    ]);
    expect(String(merged.os_status)).toBe(String(merged.status));
  });
});

/**
 * An `op:` group has no STO for a row to be foreign to. Comparing a KLIP shipment id against an
 * operation id marked every row foreign, cleared every milestone, and rescued the whole group -
 * over-rescuing contract 1004030359 (own STO MNL-37125720-1004030359) by 3,003 MT and pushing
 * CPO / BONTANG from 161 MT under Shipments to 2,841 MT over it.
 */
describe('narrowing applies only inside a real STO group', () => {
  it('leaves an operation-keyed group alone', () => {
    const merged = mergeShippingPerfStoGroup([
      {
        sto_key: '',
        operation_id: 'OP-SEA-170920260001',
        shipment_id: 'MNL-37125720-1004030359',
        contract_number: '1004030359',
        status: 'PLANNED',
        discharge_ata_completed: '2026-09-01',
      },
      {
        sto_key: '',
        operation_id: 'OP-SEA-170920260001',
        shipment_id: 'MNL-25691105-1004031651',
        contract_number: '1004031651',
        status: 'PLANNED',
      },
    ]);
    expect(String(merged.status).toUpperCase()).toBe('COMPLETED');
    // No STO to be foreign to, so the stage is not narrowed and the group stays finished.
    expect(String(merged.os_status)).toBe(String(merged.status));
  });
});
