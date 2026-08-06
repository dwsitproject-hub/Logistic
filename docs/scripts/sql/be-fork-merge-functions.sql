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
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = p_schema AND table_name = p_table AND column_name = 'refreshed_at'
    ) THEN 'refreshed_at'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION be_fork.primary_key_columns(p_schema text, p_table text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    string_agg(format('%I', kcu.column_name), ', ' ORDER BY kcu.ordinal_position),
    ''
  )
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
   AND tc.table_name = kcu.table_name
  WHERE tc.table_schema = p_schema
    AND tc.table_name = p_table
    AND tc.constraint_type = 'PRIMARY KEY';
$$;

CREATE OR REPLACE FUNCTION be_fork.pk_match_sql(
  p_schema text,
  p_table text,
  p_public_alias text,
  p_staging_alias text
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    string_agg(
      format('%s.%I = %s.%I', p_public_alias, kcu.column_name, p_staging_alias, kcu.column_name),
      ' AND ' ORDER BY kcu.ordinal_position
    ),
    'FALSE'
  )
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
   AND tc.table_name = kcu.table_name
  WHERE tc.table_schema = p_schema
    AND tc.table_name = p_table
    AND tc.constraint_type = 'PRIMARY KEY';
$$;

CREATE OR REPLACE FUNCTION be_fork.unique_insert_exclude_sql(p_table text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_pk_match text;
  v_filters text := '';
  r record;
BEGIN
  v_pk_match := be_fork.pk_match_sql('be_fork', p_table, 'p', 'b');
  IF v_pk_match = 'FALSE' THEN
    RETURN '';
  END IF;

  FOR r IN
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
     AND tc.table_name = kcu.table_name
    WHERE tc.table_schema = 'be_fork'
      AND tc.table_name = p_table
      AND tc.constraint_type = 'UNIQUE'
    GROUP BY tc.constraint_name, kcu.column_name
    HAVING COUNT(*) = 1
  LOOP
    v_filters := v_filters || format(
      ' AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.%I = b.%I AND NOT (%s))',
      p_table, r.column_name, r.column_name, v_pk_match
    );
  END LOOP;

  RETURN v_filters;
END;
$$;

/** Require FK parent rows to exist in public before insert/update. */
CREATE OR REPLACE FUNCTION be_fork.fk_parent_exists_sql(p_table text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_filters text := '';
  r record;
BEGIN
  FOR r IN
    SELECT
      src_a.attname AS fk_column,
      ref_ns.nspname AS ref_schema,
      ref_cls.relname AS ref_table,
      ref_a.attname AS ref_column
    FROM pg_constraint c
    JOIN pg_class src_cls ON src_cls.oid = c.conrelid
    JOIN pg_namespace src_ns ON src_ns.oid = src_cls.relnamespace
    JOIN pg_attribute src_a
      ON src_a.attrelid = c.conrelid
     AND src_a.attnum = ANY (c.conkey)
     AND NOT src_a.attisdropped
    JOIN pg_class ref_cls ON ref_cls.oid = c.confrelid
    JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
    JOIN pg_attribute ref_a
      ON ref_a.attrelid = c.confrelid
     AND ref_a.attnum = ANY (c.confkey)
     AND NOT ref_a.attisdropped
    WHERE c.contype = 'f'
      AND src_ns.nspname = 'public'
      AND src_cls.relname = p_table
      AND ref_ns.nspname = 'public'
      AND array_length(c.conkey, 1) = 1
  LOOP
    v_filters := v_filters || format(
      ' AND EXISTS (SELECT 1 FROM public.%I p WHERE p.%I = b.%I)',
      r.ref_table, r.ref_column, r.fk_column
    );
  END LOOP;

  RETURN v_filters;
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
  v_pk text;
  v_col_list text;
  v_set_clause text;
  v_unique_filter text;
  v_fk_filter text;
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

  v_pk := be_fork.primary_key_columns('be_fork', p_table);
  IF v_pk = '' THEN
    RAISE NOTICE 'skip % (no primary key)', p_table;
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
  FROM information_schema.columns c
  WHERE table_schema = 'be_fork'
    AND table_name = p_table
    AND NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = 'be_fork'
        AND tc.table_name = p_table
        AND tc.constraint_type = 'PRIMARY KEY'
        AND kcu.column_name = c.column_name
    );

  IF v_set_clause IS NULL OR v_set_clause = '' THEN
    v_set_clause := format('%s = %s', split_part(v_pk, ',', 1), split_part(v_pk, ',', 1));
  END IF;

  v_unique_filter := be_fork.unique_insert_exclude_sql(p_table);
  v_fk_filter := be_fork.fk_parent_exists_sql(p_table);

  v_sql := format($q$
    WITH src AS (
      SELECT b.* FROM be_fork.%I b
      WHERE b.%I >= $1%s%s
    ),
    upserted AS (
      INSERT INTO public.%I (%s)
      SELECT %s FROM src
      ON CONFLICT (%s) DO UPDATE SET
        %s
      WHERE COALESCE(public.%I.%I, 'epoch'::timestamptz)
        < COALESCE(EXCLUDED.%I, 'epoch'::timestamptz)
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT
      COUNT(*) FILTER (WHERE was_insert),
      COUNT(*) FILTER (WHERE NOT was_insert)
    FROM upserted
  $q$,
    p_table, v_ts, v_unique_filter,
    p_table, v_col_list, v_col_list, v_pk, v_set_clause,
    p_table, v_ts, v_ts
  );

  BEGIN
    EXECUTE v_sql INTO v_ins, v_upd USING p_cutoff;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'merge_table(%) failed: %', p_table, SQLERRM;
  END;

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
  v_pk_match text;
  v_cnt bigint;
BEGIN
  v_ts := be_fork.ts_column('be_fork', p_table);
  IF v_ts IS NULL THEN
    RETURN 0;
  END IF;

  v_pk_match := be_fork.pk_match_sql('be_fork', p_table, 'p', 'b');
  IF v_pk_match = 'FALSE' THEN
    RETURN 0;
  END IF;

  EXECUTE format(
    'SELECT COUNT(*) FROM be_fork.%I b
     WHERE b.%I >= $1
       AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE %s)',
    p_table, v_ts, p_table, v_pk_match
  ) INTO v_cnt USING p_cutoff;

  RETURN COALESCE(v_cnt, 0);
END;
$$;
