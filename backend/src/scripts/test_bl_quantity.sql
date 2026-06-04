SELECT 
  key, 
  value, 
  jsonb_typeof(value) as val_type, 
  value::text as as_text, 
  TRIM(BOTH '"' FROM value::text) as trimmed, 
  safe_to_numeric(TRIM(BOTH '"' FROM value::text)) as converted 
FROM sap_processed_data, jsonb_each(data->'raw') 
WHERE data->'raw' IS NOT NULL 
  AND key LIKE '%B/L Quantity%' 
  AND value IS NOT NULL 
LIMIT 2;

