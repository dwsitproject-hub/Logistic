-- JPS: drop the held rows that a later row for the same STO has superseded.
--
-- Until submit.ts nextRevision reused the revision of a row that never reached JPS, an STO KLIP held back (no DHM code on a product, vessel or port, a company JPS does
-- not map) was recorded again on EVERY sweep as the next revision: one SKIPPED_NO_CARGO row every 15 minutes, up to 100 rows for one STO on SIT, and the STO went out
-- as R9 after eight held attempts. A held row carries no JPS id and no payload, only the last reason, so a held row with a NEWER row behind it (held again, failed, or
-- submitted) holds nothing the newer row does not. The newest row of each STO is never touched, so a STO that is still held keeps its current reason. Gaps in the
-- revision numbers are harmless: the next revision is one past the highest that remains.
--
-- Safe to run again: once the superseded rows are gone, it matches nothing.

DELETE FROM jps_shipping_instructions j
 WHERE j.state = 'SKIPPED_NO_CARGO'
   AND EXISTS (
         SELECT 1
           FROM jps_shipping_instructions n
          WHERE n.sto_key = j.sto_key
            AND n.revision > j.revision
       );
