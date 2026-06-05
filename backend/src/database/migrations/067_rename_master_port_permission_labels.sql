-- Rename Master Loading Port permission labels to Master Port
UPDATE permissions
SET
  permission_name = 'Master Port Page',
  description = 'Access to Master Port management page'
WHERE permission_key = 'page.master_loading_ports';

UPDATE permissions
SET
  permission_name = 'Master Port Data',
  description = 'Create/edit Master Port records'
WHERE permission_key = 'data.master_loading_ports';
