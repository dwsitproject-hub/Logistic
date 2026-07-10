-- Shared predicate: true when trucking_operations.status is a cancelled variant.
-- Used by staging cleanup scripts (CANCELLED / CANCELED / CANCEL / case variants).

-- Expression form (use as: WHERE trucking_status_is_cancelled(t.status))
-- Inline form: UPPER(TRIM(COALESCE(t.status, ''))) IN ('CANCELLED', 'CANCELED', 'CANCEL')
