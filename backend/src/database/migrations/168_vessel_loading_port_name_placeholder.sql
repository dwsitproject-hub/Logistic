-- A UI label stopped being stored as a port name.
--
-- The bug. `port_name` was NOT NULL, so when a user saved a port without a usable name the save
-- path had nothing to store and substituted the label the screen shows: `Loading Port 2`, or
-- `Discharge Port` for the discharge row. That text then lived in the database as if it were the
-- port's name, indistinguishable from a port genuinely called that - and it travelled: the wave-2
-- ETA migration surfaced one, PO 1581000913, whose "port name" was `Loading Port 1`.
--
-- The fix has two halves, and neither works alone: the column becomes nullable so the save path
-- has an honest option, and the labels already stored are cleared.
--
-- Display is unaffected. `resolveKlipPortNameFromRow` already treats a blank name as absent and
-- the modal renders "Loading Port N" as its own badge beside the field, so the label stays exactly
-- where it belongs - on the screen, not in the data.

ALTER TABLE vessel_loading_ports
  ALTER COLUMN port_name DROP NOT NULL;

-- Cleared narrowly, matching only what that code path could have produced:
--   * a loading row whose name is `Loading Port <its own sequence>`
--   * a discharge row whose name is exactly `Discharge Port`
-- A real port that happens to be called something similar is left alone, and so is any row where
-- the number does not match its own sequence - that would be a different story and worth a look.
UPDATE vessel_loading_ports
SET port_name = NULL
WHERE COALESCE(is_discharge_port, FALSE) = FALSE
  AND TRIM(port_name) = 'Loading Port ' || COALESCE(port_sequence, 1)::text;

UPDATE vessel_loading_ports
SET port_name = NULL
WHERE COALESCE(is_discharge_port, FALSE) = TRUE
  AND TRIM(port_name) = 'Discharge Port';

COMMENT ON COLUMN vessel_loading_ports.port_name IS
  'Port name as entered or imported. NULL when none is known - never a display label; the screen supplies "Loading Port N" itself.';
