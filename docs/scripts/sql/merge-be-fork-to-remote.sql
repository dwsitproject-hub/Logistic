-- Merge template for BE fork → remote public schema.
-- Implemented as PL/pgSQL functions; apply via apply-be-fork-merge.sh.
--
-- Manual usage (after load-be-fork-to-remote-staging.sh):
--   \i docs/scripts/sql/be-fork-merge-functions.sql
--   SELECT * FROM be_fork.merge_table('contracts', '2026-08-03'::timestamptz);
--
-- See docs/BE-DB-FORK-MIGRATION-RUNBOOK.md

\ir be-fork-merge-functions.sql
