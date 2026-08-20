/** Status values that mean an SAP import job is still running. */
export const SAP_IMPORT_IN_FLIGHT_STATUSES = ['processing', 'pending'] as const;

export type SapImportInFlightStatus = (typeof SAP_IMPORT_IN_FLIGHT_STATUSES)[number];

/** Latest in-flight import row with live progress counters (see sapMasterV2.controller getAllImports). */
export const SQL_ACTIVE_SAP_IMPORT = `
  SELECT
    i.id,
    i.import_date,
    i.import_timestamp,
    i.status,
    i.total_records,
    COALESCE(i.processed_records, 0)::int AS processed_records,
    COALESCE(i.failed_records, 0)::int AS failed_records
  FROM sap_data_imports i
  WHERE i.status IN ('processing', 'pending')
  ORDER BY i.import_timestamp DESC NULLS LAST
  LIMIT 1`;

/** Fast existence check for middleware guards. */
export const SQL_SAP_IMPORT_IN_FLIGHT_EXISTS = `
  SELECT 1
  FROM sap_data_imports
  WHERE status IN ('processing', 'pending')
  LIMIT 1`;

export function isSapImportInFlightStatus(status: string | null | undefined): boolean {
  return status === 'processing' || status === 'pending';
}
