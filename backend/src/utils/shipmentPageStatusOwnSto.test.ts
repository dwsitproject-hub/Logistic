import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { shipmentEffectiveStatusExpr, shipmentPageEffectiveStatusExpr } from './shipmentListFilters';

/**
 * The Shipments page decides a row's stage on the discharge ATC of the group's OWN STO.
 *
 * Production 2026-10-20, TANJUNG PURA: BG. AS MARINA 10 (STO 1006020666 grouped with 1006020342, whose ATC is 2026-10-03) and BG. KALTIM (a PLANNED
 * shipment grouped with three finished siblings) read COMPLETED in the list and in the card counts - the group-wide ATC - while the OS path, which reads
 * the own-STO column, counted 4,999.7 + 3,145.2 MT on an active stage. The status cards then had no row for that stage, the zero guard cleared its OS and
 * the strip came 8,144.9 MT under the OS card. This runs both expressions in Postgres on rows shaped like those two, so it proves the SQL, not a string.
 */
const ROW_COLUMNS = `
  status, is_contract_sap_closed, is_contract_os_within_band,
  ata_vessel_complete_discharge, ata_vessel_complete_discharge_own_sto,
  ata_vessel_start_discharging, ata_vessel_start_discharging_own_sto,
  ata_vessel_berthed_at_discharge_port, ata_vessel_berthed_at_discharge_port_own_sto,
  ata_vessel_arrive_at_discharge_port, ata_vessel_arrive_at_discharge_port_own_sto,
  ata_vessel_sailed_from_loading_port, ata_vessel_sailed_from_loading_port_own_sto,
  ata_vessel_completed_loading, ata_vessel_completed_loading_own_sto,
  ata_vessel_start_loading, ata_vessel_start_loading_own_sto,
  ata_vessel_berthed_at_loading_port, ata_vessel_berthed_at_loading_port_own_sto,
  ata_vessel_arrival_at_loading_port, ata_vessel_arrival_at_loading_port_own_sto,
  eta_arrival, eta_berthed, eta_loading_start, eta_loading_complete, eta_sailed,
  eta_discharge_arrival, eta_discharge_berthed, eta_discharge_start, eta_vessel_complete_discharge,
  quantity_delivered, quantity_delivered_klip`;

/** One row per case; every column not named stays a typed NULL (an untyped one cannot be UNIONed with a date). */
const NULL_OF: Record<string, string> = { status: 'NULL::text', quantity_delivered: 'NULL::numeric', quantity_delivered_klip: 'NULL::numeric' };
const rowSql = (label: string, over: Record<string, string>) => {
  const cols = ROW_COLUMNS.split(',').map((c) => c.trim());
  const values = cols.map((c) => {
    if (over[c] !== undefined) return over[c];
    if (c === 'is_contract_sap_closed' || c === 'is_contract_os_within_band') return 'FALSE';
    return NULL_OF[c] ?? 'NULL::date';
  });
  return `SELECT '${label}'::text AS label, ${cols.map((c, i) => `${values[i]} AS ${c}`).join(', ')}`;
};

describe('the Shipments page reads the own-STO discharge ATC for the stage of a row', () => {
  const rows = [
    // a sibling STO's ATC on the group, nothing of its own, GR Open: still an active row
    rowSql('sibling-atc-sailed', {
      status: "'SAILED'",
      ata_vessel_complete_discharge: "DATE '2026-10-03'",
      ata_vessel_sailed_from_loading_port: "DATE '2026-09-20'",
      ata_vessel_sailed_from_loading_port_own_sto: "DATE '2026-09-20'",
    }),
    // STO 1006020666: sibling start-discharging on the group, this STO has only arrived at LP.
    rowSql('sibling-start-discharge', {
      status: "'ARRIVED_LP'",
      ata_vessel_start_discharging: "DATE '2026-10-18'",
      ata_vessel_arrival_at_loading_port_own_sto: "DATE '2026-10-10'",
    }),
    rowSql('sibling-atc-planned', {
      status: "'PLANNED'",
      ata_vessel_complete_discharge: "DATE '2026-08-30'",
      eta_arrival: "DATE '2026-10-01'",
    }),
    // the group's own STO discharged: finished
    rowSql('own-atc', {
      status: "'SAILED'",
      ata_vessel_complete_discharge: "DATE '2026-10-03'",
      ata_vessel_complete_discharge_own_sto: "DATE '2026-10-03'",
    }),
    // GR Close finishes a row whichever ATC it has
    rowSql('gr-closed', { status: "'SAILED'", is_contract_sap_closed: 'TRUE', ata_vessel_complete_discharge: "DATE '2026-10-03'" }),
    rowSql('cancelled', { status: "'CANCELLED'" }),
  ].join(' UNION ALL ');

  it('the page expression says what the OS path says; the generic one keeps the group-wide ATC', async () => {
    const r = await query(
      `SELECT label,
              ${shipmentPageEffectiveStatusExpr('t')} AS page_status,
              ${shipmentPageEffectiveStatusExpr('t')} AS os_status,
              ${shipmentEffectiveStatusExpr('t')} AS group_status
         FROM (${rows}) t`,
    );
    const by = Object.fromEntries(r.rows.map((x: { label: string }) => [x.label, x]));

    // the two rows of production: active on the page, as they already were for the OS
    expect(by['sibling-atc-sailed'].page_status).toBe('SAILED');
    expect(by['sibling-atc-planned'].page_status).toBe('PLANNED');
    expect(by['sibling-start-discharge'].page_status).toBe('ARRIVED_LP');
    expect(by['sibling-start-discharge'].group_status).toBe('UNLOADING');
    // ... where the group-wide reading made them COMPLETED
    expect(by['sibling-atc-sailed'].group_status).toBe('COMPLETED');
    expect(by['sibling-atc-planned'].group_status).toBe('COMPLETED');

    // finished when the own STO discharged, or GR is Close, and Cancelled stays Cancelled
    expect(by['own-atc'].page_status).toBe('COMPLETED');
    expect(by['gr-closed'].page_status).toBe('COMPLETED');
    expect(by['cancelled'].page_status).toBe('CANCELLED');

    // list, card counts and OS path can no longer disagree about a row
    for (const x of r.rows) expect(x.page_status).toBe(x.os_status);
  }, 60_000);
});
