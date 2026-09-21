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
