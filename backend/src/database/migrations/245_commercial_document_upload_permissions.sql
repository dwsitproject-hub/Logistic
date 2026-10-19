-- Commercial Documents: who may upload each document type is a role permission, edited in Role Management (no hard-coded role list).
--
-- One permission per type, category 'data', so the Roles page lists them under Data Access beside data.commercial_documents:
--   data.commercial_documents.upload.<document type>
-- can_create (or can_edit) on it lets the role / level / transport type upload that type. ADMIN always may.
-- View and delete are unchanged: anyone with the page sees every type, and delete stays data.commercial_documents can_delete.

INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT v.permission_key, v.permission_name, v.description, 'data'
FROM (VALUES
  ('data.commercial_documents.upload.draft_contract',   'Commercial Documents Upload: Draft Contract',                 'Upload Draft Contract files on the Commercial Documents page'),
  ('data.commercial_documents.upload.contract',         'Commercial Documents Upload: Contract',                       'Upload Contract files on the Commercial Documents page'),
  ('data.commercial_documents.upload.addendum_contract','Commercial Documents Upload: Addendum Contract',             'Upload Addendum Contract files on the Commercial Documents page'),
  ('data.commercial_documents.upload.berita_acara',     'Commercial Documents Upload: Berita Acara (BA)',              'Upload Berita Acara (BA) files on the Commercial Documents page'),
  ('data.commercial_documents.upload.bea_cukai',        'Commercial Documents Upload: Bea Cukai',                      'Upload Bea Cukai files on the Commercial Documents page'),
  ('data.commercial_documents.upload.delivery_order',   'Commercial Documents Upload: DO',                             'Upload DO (Delivery Order) files on the Commercial Documents page'),
  ('data.commercial_documents.upload.invoice_fp_dp',    'Commercial Documents Upload: Invoice + FP Down Payment (DP)', 'Upload Invoice + FP Down Payment (DP) files on the Commercial Documents page'),
  ('data.commercial_documents.upload.invoice_fp_payoff','Commercial Documents Upload: Invoice + FP Payoff (PO)',      'Upload Invoice + FP Payoff (PO) files on the Commercial Documents page'),
  ('data.commercial_documents.upload.invoice_fp_full',  'Commercial Documents Upload: Invoice + FP (Full Receive)',    'Upload Invoice + FP (Full Receive) files on the Commercial Documents page')
) AS v(permission_key, permission_name, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.permission_key = v.permission_key);

-- Start from what is true today: every role / level / transport type that can upload on the page (create or edit on the page or data key) may upload
-- every type. Nobody gains or loses anything from this step; the two rules below are the only narrowing.
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT DISTINCT rp.role_id, up.id, true, true, true, false, rp.level, rp.transport_type
FROM role_permissions rp
JOIN permissions bp
  ON bp.id = rp.permission_id
 AND bp.permission_key IN ('page.commercial_documents', 'data.commercial_documents')
JOIN permissions up ON up.permission_key LIKE 'data.commercial_documents.upload.%'
WHERE (rp.can_create OR rp.can_edit)
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = rp.role_id
      AND x.permission_id = up.id
      AND x.level IS NOT DISTINCT FROM rp.level
      AND x.transport_type IS NOT DISTINCT FROM rp.transport_type
  );

-- The two rules asked for, applied once; change them any time in Role Management.
--   DO         only LOGISTICS
--   Bea Cukai  only BC
-- (ADMIN is not listed because ADMIN always may.)
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.id
  AND rp.role_id = r.id
  AND p.permission_key = 'data.commercial_documents.upload.delivery_order'
  AND r.role_name NOT IN ('ADMIN', 'LOGISTICS');

DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.id
  AND rp.role_id = r.id
  AND p.permission_key = 'data.commercial_documents.upload.bea_cukai'
  AND r.role_name NOT IN ('ADMIN', 'BC');
