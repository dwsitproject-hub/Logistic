import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { buildShipmentListAtaSelectSql, sqlOwnStoDischargeAtc, sqlOwnStoMilestone } from './shipmentAtaOverrideSql';
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

  it('shows the Edit shipment ATC on the view table instead of a sibling MAX', () => {
    const sql = buildShipmentListAtaSelectSql('K', { displayCompleteDischargeFromPrimary: true }).replace(/\s+/g, ' ');
    expect(sql).toContain('array_agg');
    expect(sql).toContain('COALESCE(v_atc.is_cancelled, false) = false');
    expect(sql).toContain(')[1] as ata_vessel_complete_discharge');
    expect(sql).toContain('as ata_vessel_complete_discharge_own_sto');
  });

  it('leaves the group-wide column for the list to DISPLAY, but the page decides its stage on the own-STO one', () => {
    // The list keeps showing the ATA it always has. The STAGE of a row (list status, status filters, card counts, OS strip) reads the narrowed column, so a
    // sibling STO's discharge does not make a row COMPLETED in the list while the OS path counts it as active (TANJUNG PURA 2026-10-20, 8,144.9 MT).
    expect(buildShipmentListAtaSelectSql('K')).toContain('as ata_vessel_complete_discharge,');
    expect(shipmentPageEffectiveStatusExpr('sb')).toContain('sb.ata_vessel_complete_discharge_own_sto IS NOT NULL');
    expect(shipmentPageEffectiveStatusExpr('sb')).toContain('sb.ata_vessel_start_discharging_own_sto IS NOT NULL');
    expect(shipmentPageEffectiveStatusExpr('sb')).toContain('sb.ata_vessel_arrival_at_loading_port_own_sto IS NOT NULL');
    expect(shipmentPageEffectiveStatusExpr('sb')).not.toMatch(/sb.ata_vessel_complete_discharge IS NOT NULL/);
    expect(shipmentPageEffectiveStatusExpr('sb')).not.toMatch(/sb\.ata_vessel_start_discharging IS NOT NULL/);
    expect(buildShipmentListAtaSelectSql('K')).toContain('as ata_vessel_start_discharging_own_sto');
    expect(buildShipmentListAtaSelectSql('K')).toContain('as ata_vessel_arrival_at_loading_port_own_sto');
    // the generic expression keeps its default, for the callers whose base has no own-STO column
    expect(shipmentEffectiveStatusExpr('sb')).toContain('sb.ata_vessel_complete_discharge ');
  });

  it('makes the OS active-stage test read the narrowed column', () => {
    expect(sqlShipmentOutstandingActiveStagePredicate('sb')).toContain(
      'sb.ata_vessel_complete_discharge_own_sto',
    );
  });

  it('counts a group keyed by an STO on its own shipments, and a group that is not by every non-cancelled member', () => {
    const sql = buildShipmentListAtaSelectSql('K').replace(/\s+/g, ' ');
    expect(sql).toContain("NULLIF(TRIM(s.shipment_id::text), '') IS NULL"); // an STO group: a shipment with no STO of its own stays counted
    expect(sql).toContain("TRIM((K)::text) ~ '^[0-9]+$'"); // the group is keyed by an STO
    expect(sql).toContain('COUNT(*) FILTER (WHERE NOT (TRIM((K)::text)'); // otherwise: no live member may lack an ATC
  });
});

/**
 * What the own-STO discharge ATC of a group is, run in Postgres on the groups that exposed each reading (production and SIT, 2026-10-20):
 *  - MT. BIO EXPRESS, operation OP-1004031705-93196222: two POs, MNL- shipments, BOTH with an ATC (override 14 Oct). The members' MNL- ids are not the OP- key; they were marked
 *    foreign and the column was NULL, so the View Table read Unloading while the Edit modal read Completed.
 *  - MT. MULIA KARSA 2, OP-1004030473-15277540: three POs, ONE with an ATC (400/400 delivered), two without (OS 158.7 and 1,715.7 MT, Open on Contract Performance). Counting the MAX of all
 *    members finished the whole voyage and 1,874.4 MT left the Shipments OS while CP and SP kept it (Ryan 2026-10-19: while an added PO is not completed the shipment is not Completed).
 *  - STO 1006019867 / BG. KALTIM: inside an STO-keyed group a shipment of ANOTHER STO is foreign.
 */
describe('the own-STO discharge ATC of a group (run in Postgres)', () => {
  type Member = { id: string | null; status?: string; atc: string | null };
  const ownAtc = async (groupKey: string, members: Member[]) => {
    const values = members
      .map((m, i) => `($1::text, ${m.id === null ? 'NULL' : `'${m.id}'`}::text, '${m.status ?? 'PLANNED'}'::text, ${m.atc === null ? 'NULL' : `DATE '${m.atc}'`}, ${i})`)
      .join(', ');
    const r = await query(
      // to_char, not a Date round trip: node-pg turns a DATE into local midnight and toISOString() then reads the day before in WIB.
      `SELECT to_char(${sqlOwnStoDischargeAtc('s.atc', 's.group_key', 's')}, 'YYYY-MM-DD') AS own_atc
         FROM (VALUES ${values}) AS s(group_key, shipment_id, status, atc, n)
        GROUP BY s.group_key`,
      [groupKey],
    );
    return (r.rows[0]?.own_atc as string | null | undefined) ?? null;
  };
  const OP = 'OP-1004031705-93196222';

  it('an operation group is finished only when EVERY member has an ATC', async () => {
    // BIO EXPRESS: two POs, both discharged
    expect(await ownAtc(OP, [{ id: 'MNL-1-1004031704', atc: '2026-10-14' }, { id: 'MNL-1-1004031705', atc: '2026-10-14' }])).toBe('2026-10-14');
    // a single PO that discharged (DAHLIA, AS MARINA 2, SMS 3002 ...)
    expect(await ownAtc(OP, [{ id: 'MNL-9-1', atc: '2026-09-30' }])).toBe('2026-09-30');
    // MULIA KARSA 2: one PO of three discharged, the other two have no ATC: not finished
    expect(await ownAtc('OP-1004030473-15277540', [{ id: 'MNL-2-1', atc: '2026-09-15' }, { id: 'MNL-2-2', atc: null }, { id: 'MNL-2-3', atc: null }])).toBeNull();
    // KAPUAS 168: a PO added to a finished voyage keeps it open
    expect(await ownAtc(OP, [{ id: 'MNL-3-1', atc: '2026-10-16' }, { id: 'MNL-3-2', atc: null }])).toBeNull();
  }, 60_000);

  it('a cancelled member does not hold an operation group open, and an all-cancelled group has no ATC', async () => {
    expect(await ownAtc(OP, [{ id: 'MNL-4-1', atc: '2026-10-14' }, { id: 'MNL-4-2', status: 'CANCELLED', atc: null }])).toBe('2026-10-14');
    expect(await ownAtc(OP, [{ id: 'MNL-5-1', status: 'CANCELLED', atc: '2026-10-14' }])).toBeNull();
  }, 60_000);

  it('an STO group does not take a sibling start-discharging date, and an operation group takes the latest', async () => {
    const own = sqlOwnStoMilestone('s.ats', 's.group_key', 's');
    const read = async (groupKey: string, members: Array<[string, string]>) => {
      const values = members.map(([id, day], i) => `($1::text, '${id}'::text, DATE '${day}', ${i})`).join(', ');
      const r = await query(
        `SELECT to_char(${own}, 'YYYY-MM-DD') AS own_ats
           FROM (VALUES ${values}) AS s(group_key, shipment_id, ats, n)
          GROUP BY s.group_key`,
        [groupKey],
      );
      return r.rows[0]?.own_ats as string;
    };
    // 1006020666 arrived; sibling 1006020342 has already started discharging
    expect(await read('1006020666', [['1006020666', '2026-10-10'], ['1006020342', '2026-10-18']])).toBe('2026-10-10');
    expect(await read('OP-1004031705-93196222', [['MNL-1', '2026-10-10'], ['MNL-2', '2026-10-18']])).toBe('2026-10-18');
  }, 60_000);

  it('an ATC dated after today counts as no ATC (a data-entry mistake must not complete the voyage)', async () => {
    // STO group: its own ATC is in the future -> not finished
    expect(await ownAtc('1006020666', [{ id: '1006020666', atc: '2099-01-01' }])).toBeNull();
    // operation group: one PO has a real ATC, the other a future one -> not every member has an ATC
    expect(await ownAtc(OP, [{ id: 'MNL-6-1', atc: '2026-10-14' }, { id: 'MNL-6-2', atc: '2099-01-01' }])).toBeNull();
    // a single PO with a future ATC is not finished either
    expect(await ownAtc(OP, [{ id: 'MNL-7-1', atc: '2099-01-01' }])).toBeNull();
    // the past ATC still wins over a future one inside an STO group
    expect(await ownAtc('1006020666', [{ id: '1006020666', atc: '2026-10-03' }, { id: '1006020666', atc: '2099-01-01' }])).toBe('2026-10-03');
  }, 60_000);

  it('the page status reads the own-STO ATC, which is NULL for a future date, so the shipment is not Completed', () => {
    const sql = buildShipmentListAtaSelectSql('K').replace(/\s+/g, ' ');
    expect(sql).toContain('<= CURRENT_DATE');
    // the View Table cell keeps the raw date so the mistake stays visible
    expect(sql).toContain('as ata_vessel_complete_discharge,');
    expect(buildShipmentListAtaSelectSql().replace(/\s+/g, ' ')).toContain('<= CURRENT_DATE');
  });

  it('an STO group keeps the old rule: its own shipments and those with no STO count, another STO is foreign', async () => {
    expect(await ownAtc('1006019867', [{ id: '1006019867', atc: '2026-10-03' }, { id: '1006019385', atc: null }])).toBe('2026-10-03');
    expect(await ownAtc('1006019867', [{ id: '1006019385', atc: '2026-10-03' }, { id: '1006019867', atc: null }])).toBeNull(); // a sibling STO discharged
    expect(await ownAtc('1006019867', [{ id: null, atc: '2026-10-03' }])).toBe('2026-10-03'); // no STO of its own: counted
    // an STO group is NOT held open by a member without an ATC (one STO is one voyage)
    expect(await ownAtc('1006019867', [{ id: '1006019867', atc: '2026-10-03' }, { id: '1006019867', atc: null }])).toBe('2026-10-03');
  }, 60_000);
});
