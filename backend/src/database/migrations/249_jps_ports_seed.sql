-- JPS ports (Integrations > JPS > Ports, setting JPS_PORTS).
--
-- The Region/Site and the discharge Master Port used to be built into the code (BONTANG / PORT BONTANG, with JPS_REGION_SITE and JPS_DISCHARGE_PORT as single-value
-- overrides). JPS knows a port by its DHM code and has no site or region, so the scope is now only the ports switched on, and the code carries none: with no port
-- switched on, nothing is sent to JPS. This seeds the one port that was already running, as ordinary data an ADMIN can edit or switch off in the menu, so deploying the
-- change does not stop what is working. A deployment where an ADMIN has already saved the list is left alone (DO NOTHING).

INSERT INTO integration_settings (integration, setting_key, is_secret, value_plain, updated_at)
VALUES ('jps', 'JPS_PORTS', FALSE, '[{"port":"PORT BONTANG","enabled":true}]', NOW())
ON CONFLICT (integration, setting_key) DO NOTHING;
