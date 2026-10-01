-- One View checkbox per visible master menu.
-- Company (Internal) and Site split off Master Plant.
-- Incoterm splits off Master Product.
-- Existing grants are copied so current access does not change.

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT v.permission_key, v.permission_name, v.description, v.category
FROM (VALUES
  ('page.master_companies', 'Master Company (Internal)', 'Access to Master Company (Internal) page', 'page'),
  ('page.master_sites', 'Master Site', 'Access to Master Site page', 'page'),
  ('page.master_incoterms', 'Master Incoterm', 'Access to Master Incoterm page', 'page')
) AS v(permission_key, permission_name, description, category)
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = v.permission_key
);

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT src_grant.role_id, dest.id, src_grant.can_view, src_grant.can_create, src_grant.can_edit, src_grant.can_delete, src_grant.level, src_grant.transport_type
FROM role_permissions src_grant
JOIN permissions src ON src.id = src_grant.permission_id AND src.permission_key = 'page.master_plants'
JOIN permissions dest ON dest.permission_key IN ('page.master_companies', 'page.master_sites')
WHERE NOT EXISTS (
  SELECT 1
  FROM role_permissions existing
  WHERE existing.role_id = src_grant.role_id
    AND existing.permission_id = dest.id
    AND COALESCE(UPPER(TRIM(existing.level)), '') = COALESCE(UPPER(TRIM(src_grant.level)), '')
    AND COALESCE(UPPER(TRIM(existing.transport_type)), '') = COALESCE(UPPER(TRIM(src_grant.transport_type)), '')
);

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT src_grant.role_id, dest.id, src_grant.can_view, src_grant.can_create, src_grant.can_edit, src_grant.can_delete, src_grant.level, src_grant.transport_type
FROM role_permissions src_grant
JOIN permissions src ON src.id = src_grant.permission_id AND src.permission_key = 'page.master_product_configuration'
JOIN permissions dest ON dest.permission_key = 'page.master_incoterms'
WHERE NOT EXISTS (
  SELECT 1
  FROM role_permissions existing
  WHERE existing.role_id = src_grant.role_id
    AND existing.permission_id = dest.id
    AND COALESCE(UPPER(TRIM(existing.level)), '') = COALESCE(UPPER(TRIM(src_grant.level)), '')
    AND COALESCE(UPPER(TRIM(existing.transport_type)), '') = COALESCE(UPPER(TRIM(src_grant.transport_type)), '')
);

UPDATE permissions
SET
  permission_name = 'Master Product',
  description = 'Access to Master Product page'
WHERE permission_key = 'page.master_product_configuration';

UPDATE permissions
SET
  permission_name = 'Master Company (External)',
  description = 'Access to Master Company (External) page'
WHERE permission_key = 'page.suppliers';
