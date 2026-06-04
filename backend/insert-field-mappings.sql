INSERT INTO sap_field_mappings (sap_field_name, display_name, field_type, user_role, is_required, is_editable, sort_order) 
       VALUES ('FFA', 'FFA', 'text', 'QUALITY', false, true, 1) 
       ON CONFLICT (sap_field_name, user_role) DO NOTHING;

INSERT INTO sap_field_mappings (sap_field_name, display_name, field_type, user_role, is_required, is_editable, sort_order) 
       VALUES ('FFA', 'FFA', 'text', 'QUALITY', false, true, 2) 
       ON CONFLICT (sap_field_name, user_role) DO NOTHING;

INSERT INTO sap_field_mappings (sap_field_name, display_name, field_type, user_role, is_required, is_editable, sort_order) 
       VALUES ('FFA', 'FFA', 'text', 'QUALITY', false, true, 3) 
       ON CONFLICT (sap_field_name, user_role) DO NOTHING;

INSERT INTO sap_field_mappings (sap_field_name, display_name, field_type, user_role, is_required, is_editable, sort_order) 
       VALUES ('FFA', 'FFA', 'text', 'QUALITY', false, true, 4) 
       ON CONFLICT (sap_field_name, user_role) DO NOTHING;

INSERT INTO sap_field_mappings (sap_field_name, display_name, field_type, user_role, is_required, is_editable, sort_order) 
       VALUES ('Contract Completion Deviation (days)', 'Contract Completion Deviation (days)', 'text', 'ALL', false, true, 5) 
       ON CONFLICT (sap_field_name, user_role) DO NOTHING;