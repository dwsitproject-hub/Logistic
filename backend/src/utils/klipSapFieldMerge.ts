/**
 * SQL merge helpers for SAP upsert: preserve KLIP-entered values on protected fields.
 * When protectKlip=true and the row already has a value, SAP must not overwrite it.
 */

/** Text field: SAP wins when !protectKlip; KLIP wins when protectKlip and existing is set. */
export function mergeSapTextColumnSql(
  column: string,
  sapExpr: string,
  protectKlip: boolean,
  /** Qualify existing-row column (e.g. `shipments` in INSERT … ON CONFLICT DO UPDATE). */
  existingTable?: string,
): string {
  const existing = existingTable ? `${existingTable}.${column}` : column;
  if (protectKlip) {
    return `${column} = COALESCE(NULLIF(TRIM(${existing}), ''), ${sapExpr})`;
  }
  return `${column} = COALESCE(${sapExpr}, ${existing})`;
}

/** Numeric field: keep existing when protectKlip and value is not null. */
export function mergeSapNumericColumnSql(
  column: string,
  sapExpr: string,
  protectKlip: boolean,
  existingTable?: string,
): string {
  const existing = existingTable ? `${existingTable}.${column}` : column;
  if (protectKlip) {
    return `${column} = COALESCE(${existing}, ${sapExpr})`;
  }
  return `${column} = COALESCE(${sapExpr}, ${existing})`;
}

/** Port / location text: ignore blank and literal 0.00 placeholders. */
export function mergeSapPortColumnSql(
  column: string,
  sapExpr: string,
  protectKlip: boolean,
  existingTable?: string,
): string {
  const existing = existingTable ? `${existingTable}.${column}` : column;
  const existingClean = `NULLIF(NULLIF(TRIM(${existing}), ''), '0.00')`;
  const sapClean =
    sapExpr.includes('EXCLUDED.')
      ? `NULLIF(NULLIF(TRIM(COALESCE(${sapExpr}, '')), ''), '0.00')`
      : `NULLIF(NULLIF(TRIM(COALESCE(${sapExpr}::text, '')), ''), '0.00')`;

  if (protectKlip) {
    return `${column} = COALESCE(${existingClean}, ${sapClean})`;
  }
  return `${column} = COALESCE(${sapClean}, ${existingClean})`;
}

export function buildShipmentKlipProtectedSetSql(
  protectKlip: boolean,
  mode: 'param' | 'excluded',
): string {
  const vesselCode = mode === 'param' ? '$3' : 'EXCLUDED.vessel_code';
  const vesselName = mode === 'param' ? '$4' : 'EXCLUDED.vessel_name';
  const portLoading = mode === 'param' ? '$14' : 'EXCLUDED.port_of_loading';
  const portDischarge = mode === 'param' ? '$15' : 'EXCLUDED.port_of_discharge';
  const qtyDelivered = mode === 'param' ? '$19::numeric' : 'EXCLUDED.quantity_delivered';
  const qtyReceive = mode === 'param' ? '$21::numeric' : 'EXCLUDED.actual_vessel_qty_receive';
  const existingTable = mode === 'excluded' ? 'shipments' : undefined;

  return [
    mergeSapTextColumnSql('vessel_code', vesselCode, protectKlip, existingTable),
    mergeSapTextColumnSql('vessel_name', vesselName, protectKlip, existingTable),
    mergeSapPortColumnSql('port_of_loading', portLoading, protectKlip, existingTable),
    mergeSapPortColumnSql('port_of_discharge', portDischarge, protectKlip, existingTable),
    mergeSapNumericColumnSql('quantity_delivered', qtyDelivered, protectKlip, existingTable),
    mergeSapNumericColumnSql('actual_vessel_qty_receive', qtyReceive, protectKlip, existingTable),
  ].join(',\n          ');
}

export function buildTruckingKlipProtectedSetSql(protectKlip: boolean): string {
  return [
    mergeSapPortColumnSql('loading_location', '$4', protectKlip),
    mergeSapPortColumnSql('unloading_location', '$5', protectKlip),
    mergeSapNumericColumnSql('quantity_delivered', '$11::numeric', protectKlip),
  ].join(',\n          ');
}
