/** LEFT JOIN for shipment list / detail queries. */
export const SHIPMENT_ATA_OVERRIDES_JOIN = `
  LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id`;

/** SAP/base ATA from shipments + first loading/discharge port (no manual override). */
export function sqlSapAtaArrivalLoading(
  sAlias = 's',
  vlpAlias = 'vlp1',
  vlpCol = 'ata_vessel_arrival',
): string {
  return `COALESCE(${sAlias}.ata_arrival, ${vlpAlias}.${vlpCol}::date)`;
}

export function sqlSapAtaBerthedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(${sAlias}.ata_berthed, ${vlpAlias}.ata_vessel_berthed::date)`;
}

export function sqlSapAtaStartLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(${sAlias}.ata_loading_start, ${vlpAlias}.ata_loading_start::date)`;
}

export function sqlSapAtaCompletedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(${sAlias}.ata_loading_complete, ${vlpAlias}.ata_loading_completed::date)`;
}

export function sqlSapAtaSailedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(${sAlias}.ata_sailed, ${vlpAlias}.ata_vessel_sailed::date)`;
}

export function sqlSapAtaArrivalDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sAlias}.ata_discharge_arrival, ${vlpAlias}.ata_vessel_arrival::date)`;
}

export function sqlSapAtaBerthedDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sAlias}.ata_discharge_berthed, ${vlpAlias}.ata_vessel_berthed::date)`;
}

export function sqlSapAtaStartDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sAlias}.ata_discharge_start, ${vlpAlias}.ata_loading_start::date)`;
}

export function sqlSapAtaCompleteDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(${sAlias}.ata_discharge_complete, ${vlpAlias}.ata_loading_completed::date)`;
}

/** Effective ATA: manual override first, then SAP/base chain. */
export function sqlEffectiveAtaArrivalLoading(
  sAlias = 's',
  vlpAlias = 'vlp1',
  vlpCol = 'ata_vessel_arrival',
): string {
  return `COALESCE(sao.ata_arrival, ${sqlSapAtaArrivalLoading(sAlias, vlpAlias, vlpCol)})`;
}

export function sqlEffectiveAtaBerthedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(sao.ata_berthed, ${sqlSapAtaBerthedLoading(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaStartLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(sao.ata_loading_start, ${sqlSapAtaStartLoading(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaCompletedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(sao.ata_loading_complete, ${sqlSapAtaCompletedLoading(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaSailedLoading(sAlias = 's', vlpAlias = 'vlp1'): string {
  return `COALESCE(sao.ata_sailed, ${sqlSapAtaSailedLoading(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaArrivalDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(sao.ata_discharge_arrival, ${sqlSapAtaArrivalDischarge(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaBerthedDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(sao.ata_discharge_berthed, ${sqlSapAtaBerthedDischarge(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaStartDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(sao.ata_discharge_start, ${sqlSapAtaStartDischarge(sAlias, vlpAlias)})`;
}

export function sqlEffectiveAtaCompleteDischarge(sAlias = 's', vlpAlias = 'vlpd'): string {
  return `COALESCE(sao.ata_discharge_complete, ${sqlSapAtaCompleteDischarge(sAlias, vlpAlias)})`;
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
