import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { buildShipmentListAtaSelectSql, sqlShipmentBelongsToGroupStoPredicate } from './shipmentAtaOverrideSql';
import { shipmentEffectiveStatusExpr, shipmentPageEffectiveStatusExpr } from './shipmentListFilters';
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

  it('leaves the group-wide column for the list to DISPLAY, but the page decides its stage on the own-STO one', () => {
    // The list keeps showing the ATA it always has. The STAGE of a row (list status, status filters, card counts, OS strip) reads the narrowed column, so a
    // sibling STO's discharge does not make a row COMPLETED in the list while the OS path counts it as active (TANJUNG PURA 2026-10-20, 8,144.9 MT).
    expect(buildShipmentListAtaSelectSql('K')).toContain('as ata_vessel_complete_discharge,');
    expect(shipmentPageEffectiveStatusExpr('sb')).toContain('sb.ata_vessel_complete_discharge_own_sto IS NOT NULL');
    expect(shipmentPageEffectiveStatusExpr('sb')).not.toMatch(/sb.ata_vessel_complete_discharge IS NOT NULL/);
    // the generic expression keeps its default, for the callers whose base has no own-STO column
    expect(shipmentEffectiveStatusExpr('sb')).toContain('sb.ata_vessel_complete_discharge ');
  });

  it('makes the OS active-stage test read the narrowed column', () => {
    expect(sqlShipmentOutstandingActiveStagePredicate('sb')).toContain(
      'sb.ata_vessel_complete_discharge_own_sto',
    );
  });

  it('keeps a row that carries no STO of its own, and every row of a group that is not keyed by an STO', () => {
    // Such a row has no other group to belong to; excluding it would lose a real discharge.
    const sql = buildShipmentListAtaSelectSql('K').replace(/\s+/g, ' ');
    expect(sql).toContain("NULLIF(TRIM(s.shipment_id::text), '') IS NULL");
    expect(sql).toContain("TRIM((K)::text) !~ '^[0-9]+$'");
  });
});

/**
 * PO 1001031704 / operation OP-1004031705-93196222 (production 2026-10-20): a shipment planned by hand in KLIP, its shipment_id MNL-..., with an ATC. The group is keyed by the
 * OPERATION, so comparing the shipment id with the key marked it foreign and its own-STO ATC came out NULL - the View Table read Unloading while the Edit modal, which reads the
 * shipment itself, read Completed. Inside a real STO group a shipment of ANOTHER STO is still foreign (STO 1006019867, 2,700 MT, 2026-09-16). Run in Postgres, not as a string.
 */
describe('which shipments belong to the STO their group is keyed by (run in Postgres)', () => {
  const belongs = async (groupKey: string, shipmentId: string | null) => {
    const r = await query(
      `SELECT ${sqlShipmentBelongsToGroupStoPredicate('t.group_key', 's')} AS belongs
         FROM (SELECT $1::text AS group_key) t, (SELECT $2::text AS shipment_id) s`,
      [groupKey, shipmentId],
    );
    return r.rows[0].belongs as boolean;
  };

  it('an operation-keyed group counts a KLIP shipment id (MNL- / MSEA-) as its own', async () => {
    expect(await belongs('OP-1004031705-93196222', 'MNL-20260915-0001')).toBe(true);
    expect(await belongs('OP-1004031705-93196222', 'MSEA-123')).toBe(true);
    expect(await belongs('OP-1004031705-93196222', null)).toBe(true);
  }, 60_000);

  it('an STO-keyed group counts its own STO and a shipment with none, not a shipment of another STO', async () => {
    expect(await belongs('1006019867', '1006019867')).toBe(true);
    expect(await belongs('1006019867', null)).toBe(true);
    expect(await belongs('1006019867', '')).toBe(true);
    expect(await belongs('1006019867', '1006019385')).toBe(false);
  }, 60_000);
});
