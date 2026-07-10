import { query } from '../database/connection';
import { sapSpdDischargePortTextExpr } from '../utils/portDisplaySql';
import { sqlSapVesselNameFromSpdJsonb } from '../utils/sapVesselFields';

const SPD_EFFECTIVE_STO = `NULLIF(TRIM(COALESCE(
  spd.sto_number::text,
  spd.data->'raw'->>'STO No.',
  spd.data->'raw'->>'STO Number',
  spd.data->'shipment'->>'sto_no',
  spd.data->'contract'->>'sto_no'
)), '')`;

export interface StoSapPreview {
  has_sap_sto: boolean;
  vessel_name: string | null;
  port_of_discharge: string | null;
}

/** Latest SAP vessel + discharge port for an operational STO key (Add Shipment prefill). */
export async function fetchStoSapPreview(stoNumber: string): Promise<StoSapPreview> {
  const sto = String(stoNumber ?? '').trim();
  if (!sto) {
    return { has_sap_sto: false, vessel_name: null, port_of_discharge: null };
  }

  const result = await query(
    `
    SELECT
      ${sqlSapVesselNameFromSpdJsonb('spd.data')} AS vessel_name,
      ${sapSpdDischargePortTextExpr('spd')} AS port_of_discharge
    FROM sap_processed_data spd
    WHERE ${SPD_EFFECTIVE_STO} = TRIM($1::text)
    ORDER BY spd.created_at DESC NULLS LAST
    LIMIT 1
    `,
    [sto],
  );

  if (result.rows.length === 0) {
    return { has_sap_sto: false, vessel_name: null, port_of_discharge: null };
  }

  const row = result.rows[0] as { vessel_name?: string | null; port_of_discharge?: string | null };
  const vesselName = row.vessel_name?.trim() || null;
  const discharge = row.port_of_discharge?.trim() || null;

  return {
    has_sap_sto: true,
    vessel_name: vesselName,
    port_of_discharge: discharge,
  };
}
