-- 273_wb_data_page.sql
-- "WB Data": the history of the weighbridge (WB rekap) uploads made on the Trucking page, under Import Data.
-- The data is already there: trucking_wb_imports (migration 095) holds one row per upload with who (uploaded_by), when (created_at / updated_at), the file and the counts,
-- and trucking_daily_actuals.wb_import_id points back at the upload that wrote a row. This only adds the page permission.
--
-- page.wb_data:
--   - ADMIN: full access.
--   - everyone who can already EDIT the Trucking page (the people who make the uploads) gets VIEW only, with the same level / transport scope as their Trucking row.
--   Anything else is granted from the roles screen like every other page.

UPDATE permissions
SET
  permission_name = COALESCE(permission_name, 'WB Data'),
  description = COALESCE(description, 'History of the weighbridge (WB rekap) uploads: who uploaded, when, and what it wrote'),
  category = COALESCE(category, 'page')
WHERE permission_key = 'page.wb_data';

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT 'page.wb_data', 'WB Data', 'History of the weighbridge (WB rekap) uploads: who uploaded, when, and what it wrote', 'page'
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p WHERE p.permission_key = 'page.wb_data'
);

INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, true, true, true, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'ADMIN'
  AND p.permission_key = 'page.wb_data'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- View for the roles / levels that can edit Trucking (ADMIN already has its row above and is skipped by the NOT EXISTS).
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT trp.role_id, wp.id, true, false, false, false, trp.level, trp.transport_type
FROM role_permissions trp
JOIN permissions tp ON tp.id = trp.permission_id AND tp.permission_key = 'page.trucking'
CROSS JOIN permissions wp
WHERE wp.permission_key = 'page.wb_data'
  AND trp.can_edit = true
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = trp.role_id
      AND x.permission_id = wp.id
      AND x.level IS NOT DISTINCT FROM trp.level
      AND x.transport_type IS NOT DISTINCT FROM trp.transport_type
  );
