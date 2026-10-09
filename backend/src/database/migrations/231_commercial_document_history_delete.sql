-- Commercial Documents: deleting an uploaded file is audited in commercial_document_history like an upload is, so the action type
-- accepts DELETE. The table was created with an inline CHECK (ADD, EDIT); the constraint keeps its default name.
ALTER TABLE commercial_document_history DROP CONSTRAINT IF EXISTS commercial_document_history_action_type_check;
ALTER TABLE commercial_document_history
  ADD CONSTRAINT commercial_document_history_action_type_check CHECK (action_type IN ('ADD', 'EDIT', 'DELETE'));
