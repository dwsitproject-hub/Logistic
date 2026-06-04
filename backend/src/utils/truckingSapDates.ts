/**
 * SAP Trucking Start/Last Receive Date helpers (columns AV/AW).
 * Used for list display, status distribution, and filters when DB dates are empty.
 */

function sqlParseSapDateValue(valExpr: string): string {
  return `(
    CASE
      WHEN trim(${valExpr}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(${valExpr})::date
      WHEN trim(${valExpr}) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(${valExpr}), 'MM/DD/YY')
      WHEN trim(${valExpr}) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(${valExpr}), 'MM/DD/YYYY')
      ELSE NULL
    END
  )`;
}

function sqlLatestSapTruckingDateField(
  contractAlias: string,
  rawKeys: string[],
  normalizedJsonKey?: string
): string {
  const coalesceParts = [
    ...rawKeys.map((k) => `spd.data->'raw'->>'${k.replace(/'/g, "''")}'`),
    ...rawKeys.map((k) => `spd.data->>'${k.replace(/'/g, "''")}'`),
  ];
  if (normalizedJsonKey) {
    coalesceParts.push(`spd.data->'trucking'->0->'data'->>'${normalizedJsonKey}'`);
  }
  const valSelect = `COALESCE(${coalesceParts.join(', ')})`;

  return `(
    SELECT ${sqlParseSapDateValue('v.val')}
    FROM (
      SELECT ${valSelect} AS val
      FROM sap_processed_data spd
      WHERE (
        spd.contract_number = ${contractAlias}.contract_id
        OR (
          NULLIF(TRIM(${contractAlias}.sto_number::text), '') IS NOT NULL
          AND spd.sto_number = NULLIF(TRIM(${contractAlias}.sto_number::text), '')
        )
      )
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) v
    WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
  )`;
}

/** COALESCE(t.trucking_start_date, SAP Trucking Start Receive Date) */
export function sqlEffectiveTruckingStartDate(contractAlias = 'c'): string {
  return `COALESCE(
    t.trucking_start_date,
    ${sqlLatestSapTruckingDateField(
      contractAlias,
      ['Trucking Start Receive Date'],
      'trucking_start_receive_date'
    )}
  )`;
}

/** COALESCE(t.trucking_completion_date, SAP Trucking Last Receive Date) */
export function sqlEffectiveTruckingCompletionDate(contractAlias = 'c'): string {
  return `COALESCE(
    t.trucking_completion_date,
    ${sqlLatestSapTruckingDateField(
      contractAlias,
      ['Trucking Last Receive Date'],
      'trucking_last_receive_date'
    )}
  )`;
}
