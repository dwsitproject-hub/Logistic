-- The "Email after Submit to Jetty" switch (setting key JPS_NOTIFY_ENABLED) moved from the JPS panel to the new Email panel of Integrations, which holds the switches of every email KLIP sends.
-- The KEY is unchanged, so a value somebody already saved keeps working; only the integration it is filed under changes, because the app reads a setting by (integration, key) and the key is unique.
-- Safe to run twice: it touches only a row still filed under 'jps'.
UPDATE integration_settings
   SET integration = 'email'
 WHERE setting_key = 'JPS_NOTIFY_ENABLED'
   AND integration = 'jps';
