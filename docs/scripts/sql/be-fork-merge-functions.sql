-- BE fork merge helpers: upsert from staging schema be_fork → public.
-- Requires staging tables created by load-be-fork-to-remote-staging.sh

CREATE SCHEMA IF NOT EXISTS be_fork;

CREATE OR REPLACE FUNCTION be_fork.ts_column(p_schema text, p_table text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = p_schema AND table_name = p_table AND column_name = 'updated_at'
    ) THEN 'updated_at'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = p_schema AND table_name = p_table AND column_name = 'created_at'
    ) THEN 'created_at'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION be_fork.merge_table(
  p_table text,
  p_cutoff timestamptz DEFAULT '2026-08-03'::timestamptz
)
RETURNS TABLE(inserted bigint, updated bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  v_ts text;
  v_col_list text;
  v_set_clause text;
  v_sql text;
  v_ins bigint := 0;
  v_upd bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'be_fork' AND table_name = p_table
  ) THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_table
  ) THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint;
    RETURN;
  END IF;

  v_ts := be_fork.ts_column('be_fork', p_table);
  IF v_ts IS NULL THEN
    RAISE NOTICE 'skip % (no timestamp column)', p_table;
    RETURN QUERY SELECT 0::bigint, 0::bigint;
    RETURN;
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO v_col_list
  FROM information_schema.columns
  WHERE table_schema = 'be_fork' AND table_name = p_table;

  SELECT string_agg(
    format('%I = EXCLUDED.%I', column_name, column_name),
    ', ' ORDER BY ordinal_position
  )
  INTO v_set_clause
  FROM information_schema.columns
  WHERE table_schema = 'be_fork' AND table_name = p_table
    AND column_name <> 'id';

  v_sql := format($q$
    WITH src AS (
      SELECT * FROM be_fork.%I
      WHERE %I >= $1
    ),
    upserted AS (
      INSERT INTO public.%I (%s)
      SELECT %s FROM src
      ON CONFLICT (id) DO UPDATE SET
        %s
      WHERE (
        SELECT COALESCE(
          CASE WHEN %L = 'updated_at' THEN public.%I.updated_at ELSE public.%I.created_at END,
          'epoch'::timestamptz
        )
      ) < (
        SELECT COALESCE(
          CASE WHEN %L = 'updated_at' THEN EXCLUDED.updated_at ELSE EXCLUDED.created_at END,
          'epoch'::timestamptz
        )
      )
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT
      COUNT(*) FILTER (WHERE was_insert),
      COUNT(*) FILTER (WHERE NOT was_insert)
    FROM upserted
  $q$,
    p_table, v_ts,
    p_table, v_col_list, v_col_list, v_set_clause,
    v_ts, p_table, p_table,
    v_ts
  );

  EXECUTE v_sql INTO v_ins, v_upd USING p_cutoff;
  RETURN QUERY SELECT COALESCE(v_ins, 0), COALESCE(v_upd, 0);
END;
$$;

CREATE OR REPLACE FUNCTION be_fork.preview_new_ids(
  p_table text,
  p_cutoff timestamptz DEFAULT '2026-08-03'::timestamptz
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_ts text;
  v_cnt bigint;
BEGIN
  v_ts := be_fork.ts_column('be_fork', p_table);
  IF v_ts IS NULL THEN
    RETURN 0;
  END IF;

  EXECUTE format(
    'SELECT COUNT(*) FROM be_fork.%I b
     WHERE b.%I >= $1
       AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = b.id)',
    p_table, v_ts, p_table
  ) INTO v_cnt USING p_cutoff;

  RETURN COALESCE(v_cnt, 0);
END;
$$;
