-- Migration 058: Expand transport_type allowed values to include ALL and MIX
-- Previously only SEA and LAND were allowed; now also ALL and MIX for logistics users covering both modes.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_transport_type_check;

ALTER TABLE users
  ADD CONSTRAINT users_transport_type_check
  CHECK (transport_type IS NULL OR UPPER(TRIM(transport_type)) IN ('SEA', 'LAND', 'ALL', 'MIX'));

ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_transport_type_check;

ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_transport_type_check
  CHECK (transport_type IS NULL OR UPPER(TRIM(transport_type)) IN ('SEA', 'LAND', 'ALL', 'MIX'));
