-- Soft delete for documents (Edit Shipment: delete an uploaded Contract / SI / BL).
--
-- A deleted document is hidden, not destroyed: the row stays with who deleted it, when and why, and the FILE stays where it is on the share, so a mistaken delete can be
-- undone by clearing deleted_at. Every read path filters on `deleted_at IS NULL` (document list, download, view, the JPS cargo documents, the "has KLIP activity" tests), and
-- the row keeps its shipment_id so the delete still shows in that shipment's Activity History.
--
-- Additive and idempotent.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents (deleted_at) WHERE deleted_at IS NOT NULL;
