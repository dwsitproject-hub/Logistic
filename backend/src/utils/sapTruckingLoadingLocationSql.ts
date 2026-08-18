/** SQL expression: latest SAP supplier name from sap_processed_data row `spd`. */
export const sapSupplierFromProcessedDataSql = `
  NULLIF(TRIM(COALESCE(
    spd.supplier_name,
    spd.data->'contract'->>'supplier',
    spd.data->'raw'->>'Supplier',
    spd.data->'raw'->>'Supplier (vendor -> name 1))',
    spd.data->>'supplier',
    spd.data->>'Supplier'
  )), '')
`;

/** SQL expression: trucking loading location from SAP — supplier first, then truck loading fields. */
export const sapTruckingLoadingLocationSql = `
  NULLIF(TRIM(COALESCE(
    ${sapSupplierFromProcessedDataSql.trim()},
    NULLIF(TRIM(spd.data->'raw'->>'Truck Loading at Starting Location'), ''),
    NULLIF(TRIM(spd.data->'trucking'->0->'data'->>'truck_loading_at_starting_location'), ''),
    NULLIF(TRIM(spd.data->'raw'->>'Loading Location'), '')
  )), '')
`;

/** View-table overlay: SAP truck loading fields only (not Supplier). */
export const sapTruckingListLoadingLocationSql = `
  NULLIF(TRIM(COALESCE(
    NULLIF(TRIM(spd.data->'raw'->>'Truck Loading Location'), ''),
    NULLIF(TRIM(spd.data->'raw'->>'Truck Loading at Starting Location'), ''),
    NULLIF(TRIM(spd.data->'trucking'->0->'data'->>'truck_loading_at_starting_location'), ''),
    NULLIF(TRIM(spd.data->'raw'->>'Loading Location'), '')
  )), '')
`;

/** View-table overlay: SAP truck discharge / unload fields. */
export const sapTruckingListDischargeLocationSql = `
  NULLIF(TRIM(COALESCE(
    NULLIF(TRIM(spd.data->'raw'->>'Truck Discharge Location'), ''),
    NULLIF(TRIM(spd.data->'raw'->>'Truck Unload Location'), ''),
    NULLIF(TRIM(spd.data->'trucking'->0->'data'->>'truck_unloading_at_starting_location'), ''),
    NULLIF(TRIM(spd.data->'raw'->>'Truck Unloading at Starting Location'), '')
  )), '')
`;
