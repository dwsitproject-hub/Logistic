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

/** List query ATA select (uses vlp_l / vlp_d CTE aliases). */
export function buildShipmentListAtaSelectSql(): string {
  return `
          MAX(COALESCE(sao.ata_arrival, s.ata_arrival, vlp_l.vlp_load_ata_va)) as ata_vessel_arrival_at_loading_port,
          MAX(COALESCE(sao.ata_berthed, s.ata_berthed, vlp_l.vlp_load_ata_vb)) as ata_vessel_berthed_at_loading_port,
          MAX(COALESCE(sao.ata_loading_start, s.ata_loading_start, vlp_l.vlp_load_ata_ls)) as ata_vessel_start_loading,
          MAX(COALESCE(sao.ata_loading_complete, s.ata_loading_complete, vlp_l.vlp_load_ata_lc)) as ata_vessel_completed_loading,
          MAX(COALESCE(sao.ata_sailed, s.ata_sailed, vlp_l.vlp_load_ata_vs)) as ata_vessel_sailed_from_loading_port,
          MAX(COALESCE(sao.ata_discharge_arrival, s.ata_discharge_arrival, vlp_d.vlp_disc_ata_va)) as ata_vessel_arrive_at_discharge_port,
          MAX(COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed, vlp_d.vlp_disc_ata_vb)) as ata_vessel_berthed_at_discharge_port,
          MAX(COALESCE(sao.ata_discharge_start, s.ata_discharge_start, vlp_d.vlp_disc_ata_ls)) as ata_vessel_start_discharging,
          MAX(COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete, vlp_d.vlp_disc_ata_lc)) as ata_vessel_complete_discharge,`;
}
