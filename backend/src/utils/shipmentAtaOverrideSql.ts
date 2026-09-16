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
  return `COALESCE(sao.ata_discharge_arrival, ${sqlKlipStoredAtaArrivalDischarge(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaBerthedDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(sao.ata_discharge_berthed, ${sqlKlipStoredAtaBerthedDischarge(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaStartDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(sao.ata_discharge_start, ${sqlKlipStoredAtaStartDischarge(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaCompleteDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(sao.ata_discharge_complete, ${sqlKlipStoredAtaCompleteDischarge(sAlias, vlpAlias)})`;
}

/**
 * List query ATA select (uses vlp_l / vlp_d CTE aliases).
 *
 * `groupKeyExpr` adds `ata_vessel_complete_discharge_own_sto`: the same discharge ATA, but counting
 * only the rows whose own STO is the one this group is keyed by.
 *
 * For FOB with a vessel, `shipmentListSeaStoKeyExpr` keys a row by a contract-level STO pick rather
 * than by the shipment's own STO, so a contract holding two shipments on two STOs puts both in one
 * group. `MAX()` then lets a finished voyage's ATA mark a group whose own shipments have no ATA at
 * all as discharged - the execution arm drops the group as finished while the backlog rejects those
 * contracts for holding live shipments, and their quantity lands in neither. Measured on the dev
 * copy 2026-09-16: 286 FOB shipments are regrouped this way, 40 of them already discharged; STO
 * 1006019867 cost 3 contracts / 2,700 MT.
 *
 * The plain column is untouched, so the list still shows the group's ATA as it always has; only the
 * OS path reads the filtered one. Rows carrying no STO of their own stay counted either way - they
 * have no other group to belong to. The column is emitted even without `groupKeyExpr` (where it is
 * simply the same value), because every shipment_base variant has to expose the same columns or the
 * summary refresh fails on the one that does not.
 */
export function buildShipmentListAtaSelectSql(groupKeyExpr?: string): string {
  const atc = `COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete, vlp_d.vlp_disc_ata_lc)`;
  const ownStoFilter = groupKeyExpr
    ? `FILTER (WHERE NULLIF(TRIM(s.shipment_id::text), '') IS NULL
            OR TRIM(s.shipment_id::text) = TRIM((${groupKeyExpr})::text))`
    : '';
  return `
          MAX(COALESCE(sao.ata_arrival, s.ata_arrival, vlp_l.vlp_load_ata_va)) as ata_vessel_arrival_at_loading_port,
          MAX(COALESCE(sao.ata_berthed, s.ata_berthed, vlp_l.vlp_load_ata_vb)) as ata_vessel_berthed_at_loading_port,
          MAX(COALESCE(sao.ata_loading_start, s.ata_loading_start, vlp_l.vlp_load_ata_ls)) as ata_vessel_start_loading,
          MAX(COALESCE(sao.ata_loading_complete, s.ata_loading_complete, vlp_l.vlp_load_ata_lc)) as ata_vessel_completed_loading,
          MAX(COALESCE(sao.ata_sailed, s.ata_sailed, vlp_l.vlp_load_ata_vs)) as ata_vessel_sailed_from_loading_port,
          MAX(COALESCE(sao.ata_discharge_arrival, s.ata_discharge_arrival, vlp_d.vlp_disc_ata_va)) as ata_vessel_arrive_at_discharge_port,
          MAX(COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed, vlp_d.vlp_disc_ata_vb)) as ata_vessel_berthed_at_discharge_port,
          MAX(COALESCE(sao.ata_discharge_start, s.ata_discharge_start, vlp_d.vlp_disc_ata_ls)) as ata_vessel_start_discharging,
          MAX(${atc}) as ata_vessel_complete_discharge,
          MAX(${atc}) ${ownStoFilter} as ata_vessel_complete_discharge_own_sto,`;
}
