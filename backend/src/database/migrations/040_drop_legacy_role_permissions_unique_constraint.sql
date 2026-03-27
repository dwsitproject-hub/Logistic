-- Allow scoped role permissions (role + permission + level + transport_type)
-- by removing legacy uniqueness on only (role_id, permission_id).

ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_role_id_permission_id_key;

