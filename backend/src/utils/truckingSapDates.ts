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

function sqlSapTruckingRawValCoalesce(rawKeys: string[], normalizedJsonKey?: string): string {
  const coalesceParts = [
    ...rawKeys.map((k) => `spd.data->'raw'->>'${k.replace(/'/g, "''")}'`),
    ...rawKeys.map((k) => `spd.data->>'${k.replace(/'/g, "''")}'`),
  ];
  if (normalizedJsonKey) {
    coalesceParts.push(`spd.data->'trucking'->0->'data'->>'${normalizedJsonKey}'`);
  }
  return `COALESCE(${coalesceParts.join(', ')})`;
}

const SPD_EFFECTIVE_STO_MATCH = `NULLIF(TRIM(COALESCE(
  spd.sto_number::text,
  spd.data->'raw'->>'STO No.',
  spd.data->'raw'->>'STO Number',
  spd.data->'shipment'->>'sto_no',
  spd.data->'contract'->>'sto_no'
)), '')`;

function sqlLatestSapTruckingDateField(
  contractAlias: string,
  rawKeys: string[],
  normalizedJsonKey?: string
): string {
  const valSelect = sqlSapTruckingRawValCoalesce(rawKeys, normalizedJsonKey);

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

function sqlLatestSapTruckingDateByContractNumber(
  contractNumberExpr: string,
  rawKeys: string[],
  normalizedJsonKey?: string,
): string {
  const valSelect = sqlSapTruckingRawValCoalesce(rawKeys, normalizedJsonKey);
  return `(
    SELECT ${sqlParseSapDateValue('v.val')}
    FROM (
      SELECT ${valSelect} AS val
      FROM sap_processed_data spd
      WHERE spd.contract_number = ${contractNumberExpr}
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) v
    WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
  )`;
}

/** Latest SAP Trucking Last Receive Date for a contract number (newest SAP row). */
export function sqlSapTruckingLastReceiveDateByContractNumber(contractNumberExpr: string): string {
  return sqlLatestSapTruckingDateByContractNumber(
    contractNumberExpr,
    ['Trucking Last Receive Date'],
    'trucking_last_receive_date',
  );
}

/** Latest SAP Trucking Start Receive Date for a contract number (newest SAP row). */
export function sqlSapTruckingStartReceiveDateByContractNumber(contractNumberExpr: string): string {
  return sqlLatestSapTruckingDateByContractNumber(
    contractNumberExpr,
    ['Trucking Start Receive Date'],
    'trucking_start_receive_date',
  );
}

/** SAP Trucking Start Receive Date scoped to one STO key on a contract. */
export function sqlSapTruckingStartReceiveDateForStoKey(
  contractNumberExpr: string,
  stoKeyExpr: string,
): string {
  const valSelect = sqlSapTruckingRawValCoalesce(
    ['Trucking Start Receive Date'],
    'trucking_start_receive_date',
  );
  return `(
    SELECT ${sqlParseSapDateValue('v.val')}
    FROM (
      SELECT ${valSelect} AS val
      FROM sap_processed_data spd
      WHERE spd.contract_number = ${contractNumberExpr}
        AND ${SPD_EFFECTIVE_STO_MATCH} = TRIM(${stoKeyExpr}::text)
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) v
    WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
  )`;
}

/** SAP Trucking Last Receive Date scoped to one STO key on a contract. */
export function sqlSapTruckingLastReceiveDateForStoKey(
  contractNumberExpr: string,
  stoKeyExpr: string,
): string {
  const valSelect = sqlSapTruckingRawValCoalesce(
    ['Trucking Last Receive Date'],
    'trucking_last_receive_date',
  );
  return `(
    SELECT ${sqlParseSapDateValue('v.val')}
    FROM (
      SELECT ${valSelect} AS val
      FROM sap_processed_data spd
      WHERE spd.contract_number = ${contractNumberExpr}
        AND ${SPD_EFFECTIVE_STO_MATCH} = TRIM(${stoKeyExpr}::text)
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) v
    WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
  )`;
}

/**
 * Contract Detail STO table / logistics detail — Trucking Last Receive Date:
 * realization_end → SAP AW (STO-scoped) → WB Actuals MAX(progress_date).
 * Works even when trucking_operation_id is null (SAP-only STO rows).
 */
export function sqlStoTruckingLastReceiveDate(
  contractNumberExpr: string,
  stoKeyExpr: string,
  truckingOpIdExpr: string,
): string {
  return `COALESCE(
    (
      SELECT tr.realization_end_date
      FROM trucking_realizations tr
      WHERE tr.trucking_operation_id = ${truckingOpIdExpr}
      LIMIT 1
    ),
    ${sqlSapTruckingLastReceiveDateForStoKey(contractNumberExpr, stoKeyExpr)},
    (
      SELECT MAX(da.progress_date)
      FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = ${truckingOpIdExpr}
        AND (
          NULLIF(TRIM(COALESCE(da.sto_number::text, '')), '') IS NULL
          OR TRIM(da.sto_number::text) = TRIM(${stoKeyExpr}::text)
        )
    )
  )`;
}

/**
 * Same chain as {@link sqlStoTruckingLastReceiveDate} for logistics-sto-detail lookup keys.
 * Prefer joined `realization_end_date` when present.
 */
export function sqlStoTruckingLastReceiveDateForLookupKeys(
  contractNumberExpr: string,
  lookupKeysParam: string,
  truckingOpIdExpr: string,
  realizationEndExpr: string = 'tr.realization_end_date',
): string {
  return `COALESCE(
    ${realizationEndExpr},
    ${sqlSapTruckingLastReceiveDateForLookupKeys(contractNumberExpr, lookupKeysParam)},
    (
      SELECT MAX(da.progress_date)
      FROM trucking_daily_actuals da
      WHERE da.trucking_operation_id = ${truckingOpIdExpr}
        AND (
          NULLIF(TRIM(COALESCE(da.sto_number::text, '')), '') IS NULL
          OR TRIM(da.sto_number::text) = ANY(${lookupKeysParam})
        )
    )
  )`;
}

/** SAP Trucking Last Receive Date for logistics-sto-detail lookup keys ($2::text[]). */
export function sqlSapTruckingLastReceiveDateForLookupKeys(
  contractNumberExpr: string,
  lookupKeysParam: string,
): string {
  const valSelect = sqlSapTruckingRawValCoalesce(
    ['Trucking Last Receive Date'],
    'trucking_last_receive_date',
  );
  return `(
    SELECT ${sqlParseSapDateValue('v.val')}
    FROM (
      SELECT ${valSelect} AS val
      FROM sap_processed_data spd
      WHERE spd.contract_number = ${contractNumberExpr}
        AND (
          ${SPD_EFFECTIVE_STO_MATCH} = ANY(${lookupKeysParam})
          OR NULLIF(TRIM(spd.data->'raw'->>'Operation ID'), '') = ANY(${lookupKeysParam})
        )
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) v
    WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
  )`;
}

/** SAP Trucking Start Receive Date for logistics-sto-detail lookup keys ($2::text[]). */
export function sqlSapTruckingStartReceiveDateForLookupKeys(
  contractNumberExpr: string,
  lookupKeysParam: string,
): string {
  const valSelect = sqlSapTruckingRawValCoalesce(
    ['Trucking Start Receive Date'],
    'trucking_start_receive_date',
  );
  return `(
    SELECT ${sqlParseSapDateValue('v.val')}
    FROM (
      SELECT ${valSelect} AS val
      FROM sap_processed_data spd
      WHERE spd.contract_number = ${contractNumberExpr}
        AND (
          ${SPD_EFFECTIVE_STO_MATCH} = ANY(${lookupKeysParam})
          OR NULLIF(TRIM(spd.data->'raw'->>'Operation ID'), '') = ANY(${lookupKeysParam})
        )
      ORDER BY spd.created_at DESC NULLS LAST
      LIMIT 1
    ) v
    WHERE v.val IS NOT NULL AND length(trim(v.val)) >= 6
  )`;
}

/**
 * Max Trucking Last Receive across ops — extension realization_end_date, then SAP AW.
 * Does **not** include WB actuals or planning dates (cycle step 1).
 */
export function sqlMaxTruckingLastReceiveDateForContract(
  contractIdExpr: string,
  contractNumberExpr: string,
): string {
  const sap = sqlSapTruckingLastReceiveDateByContractNumber(contractNumberExpr);
  return `(
    SELECT MAX(COALESCE(
      tr.realization_end_date,
      (${sap})
    ))
    FROM trucking_operations t
    LEFT JOIN trucking_realizations tr ON tr.trucking_operation_id = t.id
    WHERE t.contract_id = ${contractIdExpr}
  )`;
}

/** Max WB Actuals daily progress_date across trucking ops for a contract (cycle step 2). */
export function sqlMaxTruckingWbActualsDateForContract(contractIdExpr: string): string {
  return `(
    SELECT MAX(da.progress_date)
    FROM trucking_operations t
    INNER JOIN trucking_daily_actuals da ON da.trucking_operation_id = t.id
    WHERE t.contract_id = ${contractIdExpr}
  )`;
}

/**
 * Max realization end across trucking ops — matches Trucking page:
 * extension realization_end_date, then SAP AW, then WB daily actuals last date
 * (never planning columns).
 */
export function sqlMaxTruckingRealizationEndForContract(
  contractIdExpr: string,
  contractNumberExpr: string,
): string {
  const sap = sqlSapTruckingLastReceiveDateByContractNumber(contractNumberExpr);
  return `(
    SELECT MAX(COALESCE(
      tr.realization_end_date,
      (${sap}),
      (
        SELECT MAX(da.progress_date)
        FROM trucking_daily_actuals da
        WHERE da.trucking_operation_id = t.id
      )
    ))
    FROM trucking_operations t
    LEFT JOIN trucking_realizations tr ON tr.trucking_operation_id = t.id
    WHERE t.contract_id = ${contractIdExpr}
  )`;
}

/**
 * Min realization start across trucking ops — SAP AV first, then WB/extension, then op start date.
 */
export function sqlMinTruckingRealizationStartForContract(
  contractIdExpr: string,
  contractNumberExpr: string,
): string {
  const sap = sqlSapTruckingStartReceiveDateByContractNumber(contractNumberExpr);
  return `(
    SELECT MIN(COALESCE((${sap}), tr.realization_start_date, t.trucking_start_date))
    FROM trucking_operations t
    LEFT JOIN trucking_realizations tr ON tr.trucking_operation_id = t.id
    WHERE t.contract_id = ${contractIdExpr}
  )`;
}

/** Latest SAP Trucking Start Receive Date only (column AV) — not merged with DB planning dates. */
export function sqlSapTruckingStartReceiveDate(contractAlias = 'c'): string {
  return sqlLatestSapTruckingDateField(
    contractAlias,
    ['Trucking Start Receive Date'],
    'trucking_start_receive_date',
  );
}

/** Latest SAP Trucking Last Receive Date only (column AW) — not merged with DB planning dates. */
export function sqlSapTruckingLastReceiveDate(contractAlias = 'c'): string {
  return sqlLatestSapTruckingDateField(
    contractAlias,
    ['Trucking Last Receive Date'],
    'trucking_last_receive_date',
  );
}

/**
 * One-lookup replacement for the per-row SAP receive-date subqueries on the Trucking list.
 *
 * Every one of those lookups selects the SAME sap_processed_data row - identical WHERE, identical
 * ORDER BY, identical LIMIT 1 - and differs only in which JSON key it reads. Written as correlated
 * subqueries the list evaluates that row selection six times per output row (start and last, each
 * used twice in the select list, plus twice more inside the pipeline-stage CASE), every time
 * repeating an index scan, a sort and a JSONB extraction.
 *
 * Measured on staging 2026-08-13: the Trucking list query sat at 23-27s under concurrent page
 * loads with the RDS instance pinned at 100% CPU and 12-14M tuples/sec returned, while the same
 * subquery in isolation ran in 314ms. The cost was repetition, not the plan - storage and memory
 * were near-idle throughout.
 *
 * Joining this LATERAL once and reading both values off it collapses the six lookups into one.
 * Verified value-identical against staging before the rewrite landed: 6642 trucking rows, zero
 * differences on both the start and the last receive value.
 *
 * Join AFTER `contracts c`; read with {@link sqlSapTruckingStartReceiveDateFromLateral} and
 * {@link sqlSapTruckingLastReceiveDateFromLateral}.
 */
export function sqlTruckingSapDatesLateral(contractAlias = 'c', alias = 'sapd'): string {
  return `
      LEFT JOIN LATERAL (
        SELECT
          ${sqlSapTruckingRawValCoalesce(['Trucking Start Receive Date'], 'trucking_start_receive_date')} AS start_val,
          ${sqlSapTruckingRawValCoalesce(['Trucking Last Receive Date'], 'trucking_last_receive_date')} AS last_val
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
      ) ${alias} ON TRUE`;
}

/**
 * Same value the correlated form yielded: the raw string counts only when present and at least 6
 * characters long. The original expressed that as a WHERE on the subquery - failing it returned no
 * row, so the scalar subquery evaluated to NULL - which is what the ELSE branch reproduces.
 */
function sqlSapTruckingDateFromLateralVal(valExpr: string): string {
  return `(CASE
    WHEN ${valExpr} IS NOT NULL AND length(trim(${valExpr})) >= 6
    THEN ${sqlParseSapDateValue(valExpr)}
    ELSE NULL
  END)`;
}

/** SAP Trucking Start Receive Date (AV) read off {@link sqlTruckingSapDatesLateral}. */
export function sqlSapTruckingStartReceiveDateFromLateral(alias = 'sapd'): string {
  return sqlSapTruckingDateFromLateralVal(`${alias}.start_val`);
}

/** SAP Trucking Last Receive Date (AW) read off {@link sqlTruckingSapDatesLateral}. */
export function sqlSapTruckingLastReceiveDateFromLateral(alias = 'sapd'): string {
  return sqlSapTruckingDateFromLateralVal(`${alias}.last_val`);
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
