import { sqlShipmentListPrimaryRowValueAgg } from './shipmentListPrimaryShipmentSql';

/** LEFT JOIN for shipment list / detail queries. */
export const SHIPMENT_ATA_OVERRIDES_JOIN = `
  LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id`;

/** Stored KLIP ATA (shipments + port) — not the SAP snapshot. */
export function sqlKlipStoredAtaArrivalLoading(
  sAlias = 's',
  vlpAlias = 'vlp1',
  vlpCol = 'ata_vessel_arrival',
): string {
  return `COALESCE(${sAlias}.ata_arrival, ${vlpAlias}.${vlpCol}::date)`;
}

export function sqlKlipStoredAtaBerthedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(${sAlias}.ata_berthed, ${vlpAlias}.ata_vessel_berthed::date)`;
}

export function sqlKlipStoredAtaStartLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(${sAlias}.ata_loading_start, ${vlpAlias}.ata_loading_start::date)`;
}

export function sqlKlipStoredAtaCompletedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(${sAlias}.ata_loading_complete, ${vlpAlias}.ata_loading_completed::date)`;
}

export function sqlKlipStoredAtaSailedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(${sAlias}.ata_sailed, ${vlpAlias}.ata_vessel_sailed::date)`;
}

export function sqlKlipStoredAtaArrivalDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sAlias}.ata_discharge_arrival, ${vlpAlias}.ata_vessel_arrival::date)`;
}

export function sqlKlipStoredAtaBerthedDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sAlias}.ata_discharge_berthed, ${vlpAlias}.ata_vessel_berthed::date)`;
}

export function sqlKlipStoredAtaStartDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sAlias}.ata_discharge_start, ${vlpAlias}.ata_loading_start::date)`;
}

export function sqlKlipStoredAtaCompleteDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sAlias}.ata_discharge_complete, ${vlpAlias}.ata_loading_completed::date)`;
}

/**
 * SAP ATA snapshot only (`vessel_loading_ports.sap_ata_*`).
 * Never COALESCE to KLIP stored ATA — empty SAP must stay NULL in the compare UI.
 */
export function sqlSapAtaArrivalLoading(
  _sAlias = 's',
  vlpAlias = 'vlp1',
  _vlpCol = 'ata_vessel_arrival',
): string {
  return `${vlpAlias}.sap_ata_vessel_arrival`;
}

export function sqlSapAtaBerthedLoading(_sAlias = 's', vlpAlias = 'vlp1'): string {
  return `${vlpAlias}.sap_ata_vessel_berthed`;
}

export function sqlSapAtaStartLoading(_sAlias = 's', vlpAlias = 'vlp1'): string {
  return `${vlpAlias}.sap_ata_loading_start`;
}

export function sqlSapAtaCompletedLoading(_sAlias = 's', vlpAlias = 'vlp1'): string {
  return `${vlpAlias}.sap_ata_loading_completed`;
}

export function sqlSapAtaSailedLoading(_sAlias = 's', vlpAlias = 'vlp1'): string {
  return `${vlpAlias}.sap_ata_vessel_sailed`;
}

export function sqlSapAtaArrivalDischarge(_sAlias = 's', vlpAlias = 'vlpd'): string {
  return `${vlpAlias}.sap_ata_vessel_arrival`;
}

export function sqlSapAtaBerthedDischarge(_sAlias = 's', vlpAlias = 'vlpd'): string {
  return `${vlpAlias}.sap_ata_vessel_berthed`;
}

export function sqlSapAtaStartDischarge(_sAlias = 's', vlpAlias = 'vlpd'): string {
  return `${vlpAlias}.sap_ata_loading_start`;
}

export function sqlSapAtaCompleteDischarge(_sAlias = 's', vlpAlias = 'vlpd'): string {
  return `${vlpAlias}.sap_ata_loading_completed`;
}

/**
 * JPS's actual for a discharge milestone, or NULL once the shipment is COMPLETED.
 *
 * The three lanes of discharge ATA are read JPS -> KLIP -> SAP while a shipment is open: this is the first argument of
 * the COALESCE, so a missing JPS value falls through to the KLIP edit and then to the SAP-filled stored value. A
 * COMPLETED shipment never reads it - its history stays as KLIP and SAP closed it. The values are filled by
 * jps/applyActuals.ts into shipment_ata_overrides.jps_ata_discharge_*.
 *
 * Every query that spells an effective discharge ATA has to carry it, or two pages disagree on the same voyage; the
 * list of those spellings is in the test for this function.
 */
export function sqlJpsAtaWhileOpen(
  column: 'jps_ata_discharge_arrival' | 'jps_ata_discharge_berthed' | 'jps_ata_discharge_start' | 'jps_ata_discharge_complete',
  saoAlias = 'sao',
  shipmentAlias = 's',
): string {
  return `CASE WHEN ${shipmentAlias}.status IS DISTINCT FROM 'COMPLETED' THEN ${saoAlias}.${column} END`;
}

/** Effective ATA: manual override first, then stored KLIP ATA (not SAP snapshot). */
export function sqlEffectiveAtaArrivalLoading(
  sAlias = 's',
  vlpAlias = 'vlp1',
  vlpCol = 'ata_vessel_arrival',
): string {
  return `COALESCE(sao.ata_arrival, ${sqlKlipStoredAtaArrivalLoading(sAlias, vlpAlias, vlpCol)})`;
}

export function sqlEffectiveAtaBerthedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(sao.ata_berthed, ${sqlKlipStoredAtaBerthedLoading(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaStartLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(sao.ata_loading_start, ${sqlKlipStoredAtaStartLoading(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaCompletedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(sao.ata_loading_complete, ${sqlKlipStoredAtaCompletedLoading(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaSailedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(sao.ata_sailed, ${sqlKlipStoredAtaSailedLoading(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaArrivalDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_arrival', 'sao', sAlias)}, sao.ata_discharge_arrival, ${sqlKlipStoredAtaArrivalDischarge(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaBerthedDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_berthed', 'sao', sAlias)}, sao.ata_discharge_berthed, ${sqlKlipStoredAtaBerthedDischarge(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaStartDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_start', 'sao', sAlias)}, sao.ata_discharge_start, ${sqlKlipStoredAtaStartDischarge(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaCompleteDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_complete', 'sao', sAlias)}, sao.ata_discharge_complete, ${sqlKlipStoredAtaCompleteDischarge(sAlias, vlpAlias)})`;
}

/**
 * One ATA milestone of the group's OWN STO.
 *
 * A numeric STO key keeps the date only from members whose `shipment_id` is empty or equals that key.
 * A sibling STO in the same FOB vessel group is foreign: its start-discharging must not move this row
 * to Unloading (STO 1006020666, BG. AS MARINA, grouped with 1006020342).
 *
 * A key that is not an STO (OP-…, MNL-…) is one voyage, so the milestone is the MAX of every member.
 * A null key is not an STO and takes the same MAX. This is not the ATC rule: ATC on an operation group
 * finishes the voyage only when every live member has one (`sqlOwnStoDischargeAtc`).
 */
export function sqlOwnStoMilestone(dateExpr: string, groupKeyExpr: string, shipmentAlias = 's'): string {
  const key = `TRIM((${groupKeyExpr})::text)`;
  const keyIsSto = `${key} ~ '^[0-9]+$'`;
  const ownMember = `(NULLIF(TRIM(${shipmentAlias}.shipment_id::text), '') IS NULL OR TRIM(${shipmentAlias}.shipment_id::text) = ${key})`;
  return `MAX(${dateExpr}) FILTER (WHERE CASE WHEN ${keyIsSto} THEN ${ownMember} ELSE TRUE END)`;
}

/**
 * The discharge ATC that counts for ONE group - `ata_vessel_complete_discharge_own_sto`. The rule depends on what the group is keyed by.
 *
 * A group keyed by a real SAP STO (digits): the ATC of the shipments that belong to THAT STO (shipment_id NULL, or equal to the key). A shipment whose own shipment_id is
 * another STO is foreign: a finished voyage on a sibling STO must not finish this one (STO 1006019867, 2,700 MT, 2026-09-16; BG. KALTIM / BG. AS MARINA 10, 2026-10-20).
 *
 * A group keyed by something that is NOT an STO - a KLIP operation id (OP-...) or a KLIP shipment id (MNL- / MSEA-): the members are the POs of one planned voyage, none is
 * foreign, and the ATC finishes the group only when EVERY member that is not cancelled has one (Ryan 2026-10-19: while a PO added to a voyage is not completed, the shipment
 * must not be Completed). Two earlier readings were wrong in opposite ways. Comparing the members' MNL- ids with the OP- key marked every member foreign, so the column was NULL even
 * when every PO had discharged: PO 1001031704 (MT. BIO EXPRESS, both POs with an ATC) read Unloading in the View Table and Completed in the Edit modal. Counting the MAX of all
 * members (6c902ce9) let one PO's ATC finish the whole voyage: MT. MULIA KARSA 2 (three POs, one with an ATC) left 1,874.4 MT out of the Shipments OS while Contract Performance
 * and Shipping Performance kept it (SIT, BONTANG). Shipping Performance already narrows only inside a `sto:` group and finishes an operation per contract.
 *
 * `atcExpr` is the member's ATC, `groupKeyExpr` the key of the group, `shipmentAlias` the shipments alias. Returns an aggregate expression (no alias).
 */
export function sqlOwnStoDischargeAtc(atcExpr: string, groupKeyExpr: string, shipmentAlias = 's'): string {
  const own = `${shipmentAlias}.shipment_id`;
  const keyIsSto = `TRIM((${groupKeyExpr})::text) ~ '^[0-9]+$'`;
  const live = `UPPER(COALESCE(${shipmentAlias}.status, '')) NOT IN ('CANCELLED', 'CANCELED')`;
  const ownMember = `(NULLIF(TRIM(${own}::text), '') IS NULL OR TRIM(${own}::text) = TRIM((${groupKeyExpr})::text))`;
  // A member whose ATC is dated after today has no ATC as far as the status is concerned (see sqlAtaNotInFuture).
  const atc = sqlAtaNotInFuture(atcExpr);
  return `COALESCE(
            MAX(${atc}) FILTER (WHERE ${keyIsSto} AND ${ownMember}),
            CASE WHEN COUNT(*) FILTER (WHERE NOT (${keyIsSto}) AND ${live} AND (${atc}) IS NULL) = 0
                 THEN MAX(${atc}) FILTER (WHERE NOT (${keyIsSto}) AND ${live})
            END
          )`;
}

/**
 * The date, or NULL when it is after today.
 *
 * An ATA is a time that already happened, so one dated in the future is a data-entry mistake. It must not make a shipment Completed:
 * the status reads the discharge ATC through this, while the View Table cell keeps showing the raw date so the mistake can be fixed.
 * Same clock as the rest of the Shipments SQL (CURRENT_DATE).
 */
export function sqlAtaNotInFuture(dateExpr: string): string {
  return `(CASE WHEN (${dateExpr})::date <= CURRENT_DATE THEN (${dateExpr}) END)`;
}

/**
 * List query ATA select (uses vlp_l / vlp_d CTE aliases).
 *
 * `groupKeyExpr` adds an `*_own_sto` column beside every milestone the page status reads.
 * The plain columns stay a MAX over the whole group, so the list still shows the group's dates.
 * The stage reads the own-STO columns.
 *
 * For FOB with a vessel, `shipmentListSeaStoKeyExpr` keys a row by a contract-level STO pick rather
 * than by the shipment's own STO, so a contract holding two shipments on two STOs puts both in one
 * group. `MAX()` then lets a sibling voyage's ATA move this row: a finished sibling marked the group
 * discharged (STO 1006019867, 2,700 MT, 2026-09-16), and a sibling that had started discharging marked
 * STO 1006020666 Unloading while its own dates only reach Arrived LP (BG. AS MARINA, production).
 *
 * Without `groupKeyExpr` each own-STO column is the same MAX, because every shipment_base variant
 * has to expose the same columns or the summary refresh fails on the one that does not.
 *
 * `displayCompleteDischargeFromPrimary` is the View Table cell. It is the ATC of the shipment Edit
 * opens (the primary member), read the same way as the modal: JPS, then the override, then the
 * shipment column, then the first active discharge port. A sibling member's date stays off that cell.
 * The own-STO column and the pipeline summary keep the group MAX, because those decide status.
 */
export function buildShipmentListAtaSelectSql(
  groupKeyExpr?: string,
  options?: { displayCompleteDischargeFromPrimary?: boolean },
): string {
  const arrivalLp = `COALESCE(sao.ata_arrival, s.ata_arrival, vlp_l.vlp_load_ata_va)`;
  const berthedLp = `COALESCE(sao.ata_berthed, s.ata_berthed, vlp_l.vlp_load_ata_vb)`;
  const startLoad = `COALESCE(sao.ata_loading_start, s.ata_loading_start, vlp_l.vlp_load_ata_ls)`;
  const completeLoad = `COALESCE(sao.ata_loading_complete, s.ata_loading_complete, vlp_l.vlp_load_ata_lc)`;
  const sailed = `COALESCE(sao.ata_sailed, s.ata_sailed, vlp_l.vlp_load_ata_vs)`;
  const arriveDp = `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_arrival')}, sao.ata_discharge_arrival, s.ata_discharge_arrival, vlp_d.vlp_disc_ata_va)`;
  const berthedDp = `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_berthed')}, sao.ata_discharge_berthed, s.ata_discharge_berthed, vlp_d.vlp_disc_ata_vb)`;
  const startDisc = `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_start')}, sao.ata_discharge_start, s.ata_discharge_start, vlp_d.vlp_disc_ata_ls)`;
  const atc = `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_complete')}, sao.ata_discharge_complete, s.ata_discharge_complete, vlp_d.vlp_disc_ata_lc)`;
  const own = (expr: string) => (groupKeyExpr ? sqlOwnStoMilestone(expr, groupKeyExpr, 's') : `MAX(${expr})`);
  const ownStoAtc = groupKeyExpr
    ? sqlOwnStoDischargeAtc(atc, groupKeyExpr, 's')
    : `MAX(${sqlAtaNotInFuture(atc)})`;
  const modalAtc = `COALESCE(${sqlJpsAtaWhileOpen('jps_ata_discharge_complete')}, sao.ata_discharge_complete, s.ata_discharge_complete, (
            SELECT v_atc.ata_loading_completed::date
            FROM vessel_loading_ports v_atc
            WHERE v_atc.shipment_id = s.id
              AND COALESCE(v_atc.is_discharge_port, false) = true
              AND COALESCE(v_atc.is_cancelled, false) = false
            ORDER BY v_atc.port_sequence NULLS LAST, v_atc.id
            LIMIT 1
          ))`;
  const displayAtc = options?.displayCompleteDischargeFromPrimary
    ? sqlShipmentListPrimaryRowValueAgg(modalAtc, groupKeyExpr, 'c', 'l', 's', 'cs_sto', 'sao')
    : `MAX(${atc})`;
  return `
          MAX(${arrivalLp}) as ata_vessel_arrival_at_loading_port,
          ${own(arrivalLp)} as ata_vessel_arrival_at_loading_port_own_sto,
          MAX(${berthedLp}) as ata_vessel_berthed_at_loading_port,
          ${own(berthedLp)} as ata_vessel_berthed_at_loading_port_own_sto,
          MAX(${startLoad}) as ata_vessel_start_loading,
          ${own(startLoad)} as ata_vessel_start_loading_own_sto,
          MAX(${completeLoad}) as ata_vessel_completed_loading,
          ${own(completeLoad)} as ata_vessel_completed_loading_own_sto,
          MAX(${sailed}) as ata_vessel_sailed_from_loading_port,
          ${own(sailed)} as ata_vessel_sailed_from_loading_port_own_sto,
          MAX(${arriveDp}) as ata_vessel_arrive_at_discharge_port,
          ${own(arriveDp)} as ata_vessel_arrive_at_discharge_port_own_sto,
          MAX(${berthedDp}) as ata_vessel_berthed_at_discharge_port,
          ${own(berthedDp)} as ata_vessel_berthed_at_discharge_port_own_sto,
          MAX(${startDisc}) as ata_vessel_start_discharging,
          ${own(startDisc)} as ata_vessel_start_discharging_own_sto,
          ${displayAtc} as ata_vessel_complete_discharge,
          ${ownStoAtc} as ata_vessel_complete_discharge_own_sto,`;
}
