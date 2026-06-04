-- Required for bulk upload ON CONFLICT (port) DO UPDATE
-- Remove duplicate ports first (keep one row per port with smallest id), then add unique constraint.
DELETE FROM master_loading_ports a
USING master_loading_ports b
WHERE a.id > b.id AND a.port = b.port;

ALTER TABLE master_loading_ports
  ADD CONSTRAINT master_loading_ports_port_key UNIQUE (port);
