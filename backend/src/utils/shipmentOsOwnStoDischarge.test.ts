import { describe, expect, it } from 'vitest';
import { buildShipmentListAtaSelectSql } from './shipmentAtaOverrideSql';
import { shipmentEffectiveStatusExpr } from './shipmentListFilters';
import { sqlShipmentOutstandingActiveStagePredicate } from './shipmentOutstandingQtySummarySql';

describe('a sibling STO\'s discharge does not finish this STO for the OS', () => {
  /*
   * For FOB with a vessel, shipmentListSeaStoKeyExpr keys a row by a contract-level STO pick, not by
   * the shipment's own STO. A contract holding two shipments on two STOs therefore puts both in one
   * group, and MAX() lets the finished voyage's ATA mark a group whose own shipments have no ATA at
   * all as discharged. The execution arm then drops the group as finished while the backlog rejects
   * those contracts for holding live shipments, so their quantity is counted nowhere.
   *
   * STO 1006019867 is the worked example: two COMPLETED shipments belonging to STO 1006019385 were
   * regrouped onto it, and 3 contracts / 2,700 MT vanished from the Shipments OS while Contract
   * Performance still counted them Open with nothing delivered. 286 FOB shipments are regrouped
   * this way on the dev copy, 40 of them already discharged.
   */
  it('emits a discharge column narrowed to the group\'s own STO', () => {
    const sql = buildShipmentListAtaSelectSql('SOME_KEY_EXPR');
    expect(sql).toContain('as ata_vessel_complete_discharge_own_sto');
    expect(sql).toContain('FILTER (WHERE');
    expect(sql).toContain('SOME_KEY_EXPR');
  });

  it('still emits the column when no group key is given, so every base CTE has it', () => {
    // A shipment_base variant missing a column the summary selects fails the refresh with 42703;
    // that has already happened once on this page, with is_contract_os_within_band.
    expect(buildShipmentListAtaSelectSql()).toContain('as ata_vessel_complete_discharge_own_sto');
  });

  it('leaves the group-wide column for the list to display', () => {
    // Option chosen deliberately: the page keeps showing the ATA it always has; only the OS
    // buckets read the narrowed column, because only they decide whether quantity is counted.
    expect(buildShipmentListAtaSelectSql('K')).toContain('as ata_vessel_complete_discharge,');
    expect(shipmentEffectiveStatusExpr('sb')).toContain('sb.ata_vessel_complete_discharge ');
  });

  it('makes the OS active-stage test read the narrowed column', () => {
    expect(sqlShipmentOutstandingActiveStagePredicate('sb')).toContain(
      'sb.ata_vessel_complete_discharge_own_sto',
    );
  });

  it('keeps a row that carries no STO of its own', () => {
    // Such a row has no other group to belong to; excluding it would lose a real discharge.
    expect(buildShipmentListAtaSelectSql('K')).toMatch(
      /FILTER \(WHERE NULLIF\(TRIM\(s\.shipment_id::text\), ''\) IS NULL/,
    );
  });
});
