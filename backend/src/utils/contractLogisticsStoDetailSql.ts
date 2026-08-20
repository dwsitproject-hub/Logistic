/** Shared SQL helpers for contract logistics STO detail (SAP fallback + matching). */

import { sqlNormalizeSapStoQtyToKgSql } from './contractPoGlobalMetricsSql';
import { sqlSapQtyTruckingFromSpd, sqlSapQtyVesselFromSpd } from './sapIncotermMetrics';
import { sqlCoalesceSapRawQtyFields } from './sapQtyPlaceholderSql';

export const SPD_EFFECTIVE_STO_SQL = `NULLIF(TRIM(COALESCE(
  spd.sto_number::text,
  spd.data->'raw'->>'STO No.',
  spd.data->'raw'->>'STO Number',
  spd.data->'shipment'->>'sto_no',
  spd.data->'contract'->>'sto_no'
)), '')`;

/**
 * Match a sap_processed_data row to the KLIP lookup key used in shipment edit/details
 * (numeric SAP STO, or OP-/MNL-/MSEA- when SAP has matching Operation ID).
 *
 * Blank SAP STO must NOT match synthetic keys globally — that pulled every empty-STO
 * contract into Edit Shipment. Pass contractNumberExpr to allow blank-STO fallback
 * only for that contract (qty / lock subqueries already scoped by contract).
 */
export function sqlStoLookupKeyMatchExpr(
  stoKeyExpr: string,
  spdAlias = 'spd',
  opts?: { contractNumberExpr?: string },
): string {
  const effectiveSto = `NULLIF(TRIM(COALESCE(
    ${spdAlias}.sto_number::text,
    ${spdAlias}.data->'raw'->>'STO No.',
    ${spdAlias}.data->'raw'->>'STO Number',
    ${spdAlias}.data->'shipment'->>'sto_no',
    ${spdAlias}.data->'contract'->>'sto_no'
  )), '')`;
  const operationId = `NULLIF(TRIM(COALESCE(
    ${spdAlias}.data->'raw'->>'Operation ID',
    ${spdAlias}.data->'shipment'->>'operation_id',
    ${spdAlias}.data->'trucking'->0->'data'->>'operation_id',
    ''
  )), '')`;
  const contractScopedBlankSto =
    opts?.contractNumberExpr != null && String(opts.contractNumberExpr).trim() !== ''
      ? `OR (
          TRIM(${stoKeyExpr}::text) ~ '^(OP-|MNL-|MSEA-)'
          AND ${spdAlias}.contract_number = ${opts.contractNumberExpr}
          AND ${effectiveSto} IS NULL
        )`
      : '';
  return `(
    TRIM(COALESCE(${spdAlias}.sto_number::text, '')) = TRIM(${stoKeyExpr}::text)
    OR ${effectiveSto} = TRIM(${stoKeyExpr}::text)
    OR (
      TRIM(${stoKeyExpr}::text) ~ '^(OP-|MNL-|MSEA-)'
      AND ${operationId} = TRIM(${stoKeyExpr}::text)
    )
    ${contractScopedBlankSto}
  )`;
}

export const SPD_SEA_LAND_SQL = `UPPER(TRIM(COALESCE(
  spd.data->'raw'->>'SEA / LAND',
  spd.data->'contract'->>'sea_land',
  spd.data->'contract'->>'transport_mode',
  ''
)))`;

function sqlCoalesceSapRawFields(keys: string[]): string {
  const parts = keys.flatMap((k) => [
    `NULLIF(TRIM(spd.data->'raw'->>'${k.replace(/'/g, "''")}'), '')`,
    `NULLIF(TRIM(spd.data->>'${k.replace(/'/g, "''")}'), '')`,
  ]);
  return `COALESCE(${parts.join(', ')})`;
}

export function sqlParseSapDateExpr(valueExpr: string): string {
  return `(
    CASE
      WHEN trim(${valueExpr}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(${valueExpr})::date
      WHEN trim(${valueExpr}) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(${valueExpr}), 'MM/DD/YY')
      WHEN trim(${valueExpr}) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(${valueExpr}), 'MM/DD/YYYY')
      ELSE NULL
    END
  )`;
}

function sqlLatestSapDateField(rawKeys: string[]): string {
  const valExpr = sqlCoalesceSapRawFields(rawKeys);
  return `MAX(${sqlParseSapDateExpr(valExpr)})`;
}

const QTY_NUM = (fields: string[]) =>
  `NULLIF(regexp_replace(COALESCE(${sqlCoalesceSapRawQtyFields(
    fields.map((f) => `spd.data->'raw'->>'${f.replace(/'/g, "''")}'`),
  )}, ''), '[^0-9\\.-]', '', 'g'), '')::numeric`;

/** SAP delivery qty (kg): trucking fields first, then vessel — MT-scale values normalized via contract qty. */
export function sqlSapQtyDeliveredAnyFromSpd(spdAlias = 'spd'): string {
  const trucking = sqlSapQtyTruckingFromSpd(spdAlias);
  const vessel = sqlSapQtyVesselFromSpd(spdAlias);
  return `COALESCE(NULLIF((${trucking}), 0), (${vessel}))`;
}

export function sqlSapQtyDeliveredKgFromSpd(
  spdAlias: string,
  contractQtyExpr: string,
): string {
  return sqlNormalizeSapStoQtyToKgSql(sqlSapQtyDeliveredAnyFromSpd(spdAlias), contractQtyExpr);
}

/** PO number from SAP JSON (raw / contract). */
export function sqlSpdPoNumberExpr(spdAlias = 'spd'): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdAlias}.po_number::text,
    ${spdAlias}.data->'raw'->>'PO No.',
    ${spdAlias}.data->'raw'->>'PO Number',
    ${spdAlias}.data->'raw'->>'PO No',
    ${spdAlias}.data->'contract'->>'po_number',
    ${spdAlias}.data->>'PO No.'
  )), '')`;
}

/** @deprecated Use sqlSpdPoNumberExpr — kept for existing imports. */
export const SPD_PO_NUMBER_SQL = sqlSpdPoNumberExpr('spd');

const SPD_QTY_RECEIVE_RAW_NUM = `NULLIF(regexp_replace(COALESCE(
  ${sqlCoalesceSapRawQtyFields([
    `spd.data->'raw'->>'Quantity Receive'`,
    `spd.data->'raw'->>'Qty Receive'`,
  ])},
  ''
), '[^0-9\\.-]', '', 'g'), '')::numeric`;

/** Match SAP row PO to a contract PO line (NULL/blank PO matches all rows on contract+STO). */
export function sqlStoPoMatchExpr(poNumberExpr: string, spdAlias = 'spd'): string {
  const po = sqlSpdPoNumberExpr(spdAlias);
  return `(
    ${poNumberExpr} IS NULL
    OR NULLIF(TRIM((${poNumberExpr})::text), '') IS NULL
    OR ${po} = NULLIF(TRIM((${poNumberExpr})::text), '')
  )`;
}

export interface StoScopedQtySqlOpts {
  contractNumberExpr: string;
  contractQtyExpr: string;
  stoKeyExpr: string;
  poNumberExpr: string;
}

function sqlLatestStoScopedQtySql(opts: StoScopedQtySqlOpts, qtySelectSql: string, extraAndSql = ''): string {
  const stoMatch = sqlStoLookupKeyMatchExpr(opts.stoKeyExpr, 'spd', {
    contractNumberExpr: opts.contractNumberExpr,
  });
  const poMatch = sqlStoPoMatchExpr(opts.poNumberExpr, 'spd');
  const extra = extraAndSql.trim() ? `\n      AND ${extraAndSql.trim()}` : '';
  return `(
    SELECT ${qtySelectSql}
    FROM sap_processed_data spd
    WHERE spd.contract_number = ${opts.contractNumberExpr}
      AND ${stoMatch}
      AND ${poMatch}${extra}
    ORDER BY spd.created_at DESC NULLS LAST, spd.id DESC
    LIMIT 1
  )`;
}

/** STO + contract + PO scoped SAP delivery qty (kg) — latest import row (not SUM of history). */
export function sqlStoScopedDeliveredKgSql(opts: StoScopedQtySqlOpts): string {
  return sqlLatestStoScopedQtySql(opts, sqlSapQtyDeliveredKgFromSpd('spd', opts.contractQtyExpr));
}

/** STO + contract + PO scoped SAP receive qty (kg) — latest import row with a receive value. */
export function sqlStoScopedReceiveKgSql(opts: StoScopedQtySqlOpts): string {
  const hasReceive = `NULLIF(TRIM(${sqlCoalesceSapRawQtyFields([
    `spd.data->'raw'->>'Quantity Receive'`,
    `spd.data->'raw'->>'Qty Receive'`,
  ])}), '') IS NOT NULL`;
  return sqlLatestStoScopedQtySql(
    opts,
    sqlNormalizeSapStoQtyToKgSql(SPD_QTY_RECEIVE_RAW_NUM, opts.contractQtyExpr),
    hasReceive,
  );
}

/** SAP STO Quantity numeric (kg) from a sap_processed_data row. */
export function sqlSapStoQuantityNumExpr(spdAlias = 'spd'): string {
  return `NULLIF(regexp_replace(COALESCE(
    NULLIF(TRIM(${spdAlias}.data->'contract'->>'sto_quantity'), ''),
    NULLIF(TRIM(${spdAlias}.data->'shipment'->>'sto_quantity'), ''),
    NULLIF(TRIM(${spdAlias}.data->'raw'->>'STO Quantity'), ''),
    NULLIF(TRIM(${spdAlias}.data->'raw'->>'sto quantity'), ''),
    ''
  ), '[^0-9\\.-]', '', 'g'), '')::numeric`;
}

function sqlSapContractOrPoMatchExpr(contractAlias = 'c', spdAlias = 'spd'): string {
  return `(
    ${spdAlias}.contract_number = ${contractAlias}.contract_id
    OR (
      NULLIF(TRIM(${contractAlias}.po_number::text), '') IS NOT NULL
      AND TRIM(COALESCE(
        ${spdAlias}.po_number::text,
        ${spdAlias}.data->'raw'->>'PO No',
        ${spdAlias}.data->'raw'->>'PO No.',
        ''
      )) = TRIM(${contractAlias}.po_number::text)
    )
  )`;
}

function sqlSapEffectiveStoEqualsKeyExpr(stoKeyExpr: string, spdAlias = 'spd'): string {
  return `NULLIF(TRIM(COALESCE(
    ${spdAlias}.sto_number::text,
    ${spdAlias}.data->'raw'->>'STO No.',
    ${spdAlias}.data->'raw'->>'STO Number',
    ${spdAlias}.data->'shipment'->>'sto_no',
    ${spdAlias}.data->'contract'->>'sto_no'
  )), '') = TRIM(${stoKeyExpr}::text)`;
}

/**
 * Match SAP rows for logistics STO list quantities.
 * - Real STO key: match by STO (contract or PO).
 * - Operation ID / synthetic key: match by contract/PO (SAP often has qty but no Operation ID),
 *   and also accept an exact Operation ID hit when present.
 */
export function sqlSapStoKeyMatchExpr(opts: {
  contractAlias?: string;
  stoKeyExpr: string;
  spdAlias?: string;
}): string {
  const c = opts.contractAlias ?? 'c';
  const spd = opts.spdAlias ?? 'spd';
  const stoKey = opts.stoKeyExpr;
  return `(
    ${sqlSapContractOrPoMatchExpr(c, spd)}
    AND (
      ${sqlSapEffectiveStoEqualsKeyExpr(stoKey, spd)}
      OR (
        TRIM(${stoKey}::text) ~ '^(OP-|MNL-|MSEA-)'
        AND (
          NULLIF(TRIM(COALESCE(
            ${spd}.data->'raw'->>'Operation ID',
            ${spd}.data->'shipment'->>'operation_id',
            ${spd}.data->'trucking'->0->'data'->>'operation_id',
            ''
          )), '') = TRIM(${stoKey}::text)
          OR NULLIF(TRIM(COALESCE(
            ${spd}.sto_number::text,
            ${spd}.data->'raw'->>'STO No.',
            ${spd}.data->'raw'->>'STO Number',
            ${spd}.data->'shipment'->>'sto_no',
            ${spd}.data->'contract'->>'sto_no'
          )), '') IS NULL
        )
      )
    )
  )`;
}

/**
 * SAP STO Qty for a contract/PO.
 * - When stoKeyExpr is a real STO: sum qty for that STO (contract or PO match).
 * - When stoKeyExpr is Operation ID / synthetic / null: sum distinct STO qtys for the PO
 *   (never falls back to Contract/PO Qty).
 */
export function sqlSapStoQtyForContractPoExpr(opts: {
  contractAlias?: string;
  stoKeyExpr?: string;
}): string {
  const c = opts.contractAlias ?? 'c';
  const stoKey = opts.stoKeyExpr ?? 'NULL::text';
  const stoQty = sqlSapStoQuantityNumExpr('spd');
  const contractOrPo = sqlSapContractOrPoMatchExpr(c, 'spd');
  const effectiveSto = SPD_EFFECTIVE_STO_SQL;

  return `COALESCE((
    CASE
      WHEN NULLIF(TRIM(${stoKey}::text), '') IS NOT NULL
        AND TRIM(${stoKey}::text) !~ '^(OP-|MNL-|MSEA-)'
      THEN (
        SELECT SUM(${stoQty})
        FROM sap_processed_data spd
        WHERE (${contractOrPo})
          AND ${effectiveSto} = TRIM(${stoKey}::text)
      )
      ELSE (
        SELECT SUM(x.sto_qty)
        FROM (
          SELECT DISTINCT ON (${effectiveSto})
            ${stoQty} AS sto_qty
          FROM sap_processed_data spd
          WHERE (${contractOrPo})
            AND ${effectiveSto} IS NOT NULL
            AND ${stoQty} IS NOT NULL
          ORDER BY ${effectiveSto}, spd.created_at DESC NULLS LAST
        ) x
      )
    END
  ), 0)`;
}

/** SAP Quantity Delivered for a logistics STO key (real STO or Operation ID fallback by PO). */
export function sqlSapQtyDeliveredForStoKeyExpr(opts: {
  contractAlias?: string;
  stoKeyExpr: string;
  contractQtyExpr?: string;
}): string {
  const c = opts.contractAlias ?? 'c';
  const stoKey = opts.stoKeyExpr;
  const contractQty = opts.contractQtyExpr ?? `${c}.quantity_ordered`;
  return `COALESCE((
    SELECT SUM(${sqlSapQtyDeliveredKgFromSpd('spd', contractQty)})
    FROM sap_processed_data spd
    WHERE ${sqlSapStoKeyMatchExpr({ contractAlias: c, stoKeyExpr: stoKey })}
  ), 0)`;
}

/** SAP Quantity Receive for a logistics STO key (real STO or Operation ID fallback by PO). */
export function sqlSapQtyReceiveForStoKeyExpr(opts: {
  contractAlias?: string;
  stoKeyExpr: string;
}): string {
  const c = opts.contractAlias ?? 'c';
  const stoKey = opts.stoKeyExpr;
  return `COALESCE((
    SELECT SUM(NULLIF(regexp_replace(COALESCE(
      ${sqlCoalesceSapRawQtyFields([
        `spd.data->'raw'->>'Quantity Receive'`,
        `spd.data->'raw'->>'Qty Receive'`,
      ])},
      ''
    ), '[^0-9\\.-]', '', 'g'), '')::numeric)
    FROM sap_processed_data spd
    WHERE ${sqlSapStoKeyMatchExpr({ contractAlias: c, stoKeyExpr: stoKey })}
  ), 0)`;
}


/** Detail payload built purely from sap_processed_data when no shipment row exists. */
export const SHIPMENT_SAP_STO_DETAIL_SQL = `
  SELECT
    NULL::uuid AS id,
    sk.effective_sto AS sto_number,
    MAX(NULLIF(TRIM(COALESCE(
      spd.data->'raw'->>'Operation ID',
      spd.data->'shipment'->>'operation_id'
    )), '')) AS operation_id,
    MAX(COALESCE(
      NULLIF(TRIM(spd.data->'raw'->>'Status'), ''),
      NULLIF(TRIM(spd.data->'contract'->>'status'), ''),
      '-'
    )) AS status,
    MAX(NULLIF(TRIM(COALESCE(
      spd.data->'raw'->>'Vessel',
      spd.data->'raw'->>'Vessel Name',
      spd.data->'shipment'->>'vessel_name'
    )), '')) AS vessel_name,
    c.contract_id AS contract_numbers,
    MAX(NULLIF(TRIM(COALESCE(
      spd.data->'raw'->>'Vessel Loading Port 1',
      spd.data->'raw'->>'Port of Loading',
      spd.data->'shipment'->>'vessel_loading_port_1'
    )), '')) AS port_of_loading,
    MAX(NULLIF(TRIM(COALESCE(
      spd.data->'raw'->>'Vessel Discharge Port',
      spd.data->'raw'->>'Port of Discharge',
      spd.data->'shipment'->>'vessel_discharge_port'
    )), '')) AS port_of_discharge,
    SUM(${QTY_NUM(['STO Quantity', 'sto quantity'])}) AS sto_quantity,
    SUM(${sqlSapQtyDeliveredKgFromSpd('spd', 'MAX(c.quantity_ordered)')}) AS quantity_delivered,
    SUM(${QTY_NUM(['Quantity Receive', 'Qty Receive'])}) AS quantity_receive,
    c.delivery_start_date,
    c.delivery_end_date,
    c.product,
    ${sqlLatestSapDateField(['ETA Vessel Completed Loading', 'ETA Loading Completed'])} AS eta_vessel_completed_loading,
    ${sqlLatestSapDateField(['ATA Vessel Completed Loading'])} AS ata_vessel_completed_loading,
    ${sqlLatestSapDateField(['ATA Vessel Complete Discharge'])} AS ata_vessel_complete_discharge,
    ${sqlLatestSapDateField(['ETA Vessel Complete Discharge'])} AS eta_vessel_complete_discharge
  FROM contracts c
  INNER JOIN sap_processed_data spd ON spd.contract_number = c.contract_id
  INNER JOIN LATERAL (
    SELECT ${SPD_EFFECTIVE_STO_SQL} AS effective_sto
  ) sk ON TRUE
  WHERE c.id = $1
    AND sk.effective_sto = ANY($2::text[])
    AND (${SPD_SEA_LAND_SQL} = '' OR ${SPD_SEA_LAND_SQL} LIKE 'SEA%')
  GROUP BY c.id, c.contract_id, c.delivery_start_date, c.delivery_end_date, c.product, sk.effective_sto
  ORDER BY sk.effective_sto
  LIMIT 1`;

/** Detail payload from SAP when no trucking_operations row exists. */
export const TRUCKING_SAP_STO_DETAIL_SQL = `
  SELECT
    NULL::uuid AS id,
    sk.effective_sto AS sto_number,
    MAX(NULLIF(TRIM(COALESCE(
      spd.data->'raw'->>'Operation ID',
      spd.data->'trucking'->0->'data'->>'operation_id'
    )), '')) AS operation_id,
    MAX(COALESCE(
      NULLIF(TRIM(spd.data->'raw'->>'Status'), ''),
      NULLIF(TRIM(spd.data->'contract'->>'status'), ''),
      '-'
    )) AS status,
    MAX(NULLIF(TRIM(COALESCE(
      spd.data->'raw'->>'Trucking Owner',
      spd.data->'trucking'->0->'data'->>'trucking_owner'
    )), '')) AS trucking_owner,
    c.contract_id AS contract_number,
    MAX(NULLIF(TRIM(COALESCE(
      spd.data->'raw'->>'Loading Location',
      spd.data->'trucking'->0->'data'->>'loading_location'
    )), '')) AS loading_location,
    MAX(NULLIF(TRIM(COALESCE(
      spd.data->'raw'->>'Unloading Location',
      spd.data->'trucking'->0->'data'->>'unloading_location'
    )), '')) AS unloading_location,
    MAX(c.quantity_ordered) AS contract_qty,
    SUM(${sqlSapQtyDeliveredKgFromSpd('spd', 'MAX(c.quantity_ordered)')}) AS quantity_delivered,
    SUM(${QTY_NUM(['Quantity Receive', 'Qty Receive'])}) AS quantity_receive,
    c.delivery_start_date,
    c.delivery_end_date,
    c.product,
    ${sqlLatestSapDateField(['Trucking Start Receive Date'])} AS trucking_start_date,
    ${sqlLatestSapDateField(['Trucking Last Receive Date'])} AS trucking_completion_date,
    ${sqlLatestSapDateField(['ETA Trucking Start Receive Date'])} AS eta_trucking_start_date,
    ${sqlLatestSapDateField(['ETA Trucking Completion Date'])} AS eta_trucking_completion_date
  FROM contracts c
  INNER JOIN sap_processed_data spd ON spd.contract_number = c.contract_id
  INNER JOIN LATERAL (
    SELECT ${SPD_EFFECTIVE_STO_SQL} AS effective_sto
  ) sk ON TRUE
  WHERE c.id = $1
    AND sk.effective_sto = ANY($2::text[])
    AND (${SPD_SEA_LAND_SQL} = '' OR ${SPD_SEA_LAND_SQL} LIKE 'LAND%')
  GROUP BY c.id, c.contract_id, c.delivery_start_date, c.delivery_end_date, c.product, sk.effective_sto
  ORDER BY sk.effective_sto
  LIMIT 1`;

/** SAP STO rows for contract detail list not already covered by shipments/trucking. */
export const CONTRACT_SAP_ONLY_STOS_SQL = `
  WITH sap_rows AS (
    SELECT
      ${SPD_EFFECTIVE_STO_SQL} AS effective_sto,
      ${SPD_SEA_LAND_SQL} AS sea_land,
      spd.data,
      spd.created_at,
      spd.contract_number,
      c.transport_mode,
      c.incoterm
    FROM sap_processed_data spd
    INNER JOIN contracts c ON c.contract_id = spd.contract_number
    WHERE c.id = $1
  ),
  sap_stos AS (
    SELECT DISTINCT ON (effective_sto)
      effective_sto,
      sea_land,
      data,
      created_at,
      contract_number,
      transport_mode,
      incoterm
    FROM sap_rows
    WHERE effective_sto IS NOT NULL AND effective_sto != ''
    ORDER BY effective_sto, created_at DESC NULLS LAST
  )
  SELECT
    s.effective_sto AS sto_number,
    NULLIF(TRIM(COALESCE(
      s.data->'raw'->>'Operation ID',
      s.data->'shipment'->>'operation_id'
    )), '') AS operation_id,
    COALESCE(
      NULLIF(TRIM(s.data->'raw'->>'Status'), ''),
      NULLIF(TRIM(s.data->'contract'->>'status'), ''),
      '-'
    ) AS status,
    COALESCE((
      SELECT SUM(NULLIF(regexp_replace(COALESCE(
        NULLIF(TRIM(spd2.data->'contract'->>'sto_quantity'), ''),
        NULLIF(TRIM(spd2.data->'shipment'->>'sto_quantity'), ''),
        NULLIF(TRIM(spd2.data->'raw'->>'STO Quantity'), ''),
        ''
      ), '[^0-9\\.-]', '', 'g'), '')::numeric)
      FROM sap_processed_data spd2
      WHERE spd2.contract_number = s.contract_number
        AND NULLIF(TRIM(COALESCE(
          spd2.sto_number::text,
          spd2.data->'raw'->>'STO No.',
          spd2.data->'raw'->>'STO Number',
          spd2.data->'shipment'->>'sto_no',
          spd2.data->'contract'->>'sto_no'
        )), '') = s.effective_sto
    ), 0) AS sto_quantity,
    COALESCE((
      SELECT SUM(${sqlSapQtyDeliveredKgFromSpd('spd2', `(SELECT MAX(c2.quantity_ordered) FROM contracts c2 WHERE c2.contract_id = s.contract_number)`)})
      FROM sap_processed_data spd2
      WHERE spd2.contract_number = s.contract_number
        AND NULLIF(TRIM(COALESCE(
          spd2.sto_number::text,
          spd2.data->'raw'->>'STO No.',
          spd2.data->'raw'->>'STO Number',
          spd2.data->'shipment'->>'sto_no',
          spd2.data->'contract'->>'sto_no'
        )), '') = s.effective_sto
    ), 0) AS quantity_delivered,
    COALESCE((
      SELECT SUM(NULLIF(regexp_replace(COALESCE(
        NULLIF(TRIM(spd2.data->'raw'->>'Quantity Receive'), ''),
        NULLIF(TRIM(spd2.data->'raw'->>'Qty Receive'), ''),
        ''
      ), '[^0-9\\.-]', '', 'g'), '')::numeric)
      FROM sap_processed_data spd2
      WHERE spd2.contract_number = s.contract_number
        AND NULLIF(TRIM(COALESCE(
          spd2.sto_number::text,
          spd2.data->'raw'->>'STO No.',
          spd2.data->'raw'->>'STO Number',
          spd2.data->'shipment'->>'sto_no',
          spd2.data->'contract'->>'sto_no'
        )), '') = s.effective_sto
    ), 0) AS quantity_receive,
    NULLIF(TRIM(COALESCE(
      s.data->'raw'->>'Vessel',
      s.data->'raw'->>'Vessel Name',
      s.data->'shipment'->>'vessel_name'
    )), '') AS vessel_name,
    NULLIF(TRIM(COALESCE(
      s.data->'raw'->>'Trucking Owner',
      s.data->'trucking'->0->'data'->>'trucking_owner'
    )), '') AS trucking_owner,
    ${sqlParseSapDateExpr(`COALESCE(
      NULLIF(TRIM(s.data->'raw'->>'ETA Vessel Arrival at Loading Port'), ''),
      NULLIF(TRIM(s.data->'raw'->>'ETA Vessel Arrival'), '')
    )`)} AS eta_vessel_arrival_loading_port,
    ${sqlParseSapDateExpr(`COALESCE(
      NULLIF(TRIM(s.data->'raw'->>'ETA Vessel Complete Discharge'), ''),
      NULLIF(TRIM(s.data->'shipment'->>'eta_vessel_complete_discharge'), '')
    )`)} AS eta_discharge_complete,
    ${sqlParseSapDateExpr(`NULLIF(TRIM(s.data->'raw'->>'ATA Vessel Complete Discharge'), '')`)} AS ata_discharge_complete,
    ${sqlParseSapDateExpr(`NULLIF(TRIM(s.data->'raw'->>'ETA Trucking Completion Date'), '')`)} AS eta_trucking_completion_date,
    ${sqlParseSapDateExpr(`NULLIF(TRIM(s.data->'raw'->>'Trucking Last Receive Date'), '')`)} AS trucking_completion_date,
    CASE
      WHEN s.sea_land LIKE 'LAND%' THEN 'trucking'
      WHEN s.sea_land LIKE 'SEA%' THEN 'shipment'
      WHEN UPPER(TRIM(COALESCE(s.transport_mode, ''))) IN ('LAND', 'MIX') THEN 'trucking'
      WHEN UPPER(TRIM(COALESCE(s.incoterm, ''))) IN ('FRC', 'LCO') THEN 'trucking'
      WHEN UPPER(TRIM(COALESCE(s.transport_mode, ''))) IN ('SEA', 'MIX') THEN 'shipment'
      ELSE 'shipment'
    END AS logistics_type
  FROM sap_stos s
  WHERE NOT (s.effective_sto = ANY($2::text[]))
  ORDER BY s.effective_sto`;
