-- Commercial Documents: SPPB and SPPD, listed right after Bea Cukai.
-- The constraint is rebuilt with every value of migration 244 plus 'sppb' and 'sppd'; nothing is removed.

ALTER TABLE commercial_document_files
  DROP CONSTRAINT IF EXISTS commercial_document_files_document_type_check;

ALTER TABLE commercial_document_files
  ADD CONSTRAINT commercial_document_files_document_type_check CHECK (
    document_type IN (
      'draft_contract',
      'contract',
      'addendum_contract',
      'berita_acara',
      'bea_cukai',
      'sppb',
      'sppd',
      'delivery_order',
      'invoice_fp_dp',
      'invoice_fp_payoff',
      'invoice_fp_full',
      -- legacy (backward compatibility)
      'faktur_pajak',
      'dp',
      'invoice_dp',
      'ep_pelunasan',
      'invoice_pelunasan'
    )
  );

-- Who may upload each type is a role permission (see migration 245). The two new types start with BC only; ADMIN always may.
-- Change it any time in Role Management.
INSERT INTO permissions (permission_key, permission_name, description, category)
SELECT v.permission_key, v.permission_name, v.description, 'data'
FROM (VALUES
  ('data.commercial_documents.upload.sppb', 'Commercial Documents Upload: SPPB', 'Upload SPPB files on the Commercial Documents page'),
  ('data.commercial_documents.upload.sppd', 'Commercial Documents Upload: SPPD', 'Upload SPPD files on the Commercial Documents page')
) AS v(permission_key, permission_name, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.permission_key = v.permission_key);

-- Copy the Bea Cukai upload rows (role / level / transport type), so exactly the roles that may upload Bea Cukai (BC) may upload these.
INSERT INTO role_permissions (role_id, permission_id, can_view, can_create, can_edit, can_delete, level, transport_type)
SELECT rp.role_id, np.id, rp.can_view, rp.can_create, rp.can_edit, false, rp.level, rp.transport_type
FROM role_permissions rp
JOIN permissions bc ON bc.id = rp.permission_id AND bc.permission_key = 'data.commercial_documents.upload.bea_cukai'
JOIN permissions np ON np.permission_key IN ('data.commercial_documents.upload.sppb', 'data.commercial_documents.upload.sppd')
JOIN roles r ON r.id = rp.role_id AND r.role_name IN ('ADMIN', 'BC')
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions x
  WHERE x.role_id = rp.role_id AND x.permission_id = np.id
    AND x.level IS NOT DISTINCT FROM rp.level
    AND x.transport_type IS NOT DISTINCT FROM rp.transport_type
);
