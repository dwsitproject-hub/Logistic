-- BE fork merge helpers: upsert from staging schema be_fork → public.
-- Requires staging tables created by load-be-fork-to-remote-staging.sh
-- Version: 20260806-10

CREATE SCHEMA IF NOT EXISTS be_fork;

CREATE OR REPLACE FUNCTION be_fork.merge_sql_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '20260806-10'::text;
$$;

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

CREATE OR REPLACE FUNCTION be_fork.pk_qualified_columns(
  p_schema text,
  p_table text,
  p_alias text
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    string_agg(format('%s.%I', p_alias, kcu.column_name), ', ' ORDER BY kcu.ordinal_position),
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

-- Require FK parent rows to exist in public before insert/update.
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

-- Map fork trucking_operations.id → public id via contract (PO) + operation_id.
CREATE OR REPLACE FUNCTION be_fork.remap_trucking_operation_id_expr(p_expr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT format($q$COALESCE((
    SELECT COALESCE(pub.id, fo.id)
    FROM be_fork.trucking_operations fo
    LEFT JOIN public.trucking_operations pub ON (
      pub.operation_id IS NOT DISTINCT FROM fo.operation_id
      AND pub.contract_id = COALESCE((
        SELECT COALESCE(pubc.id, fc.id)
        FROM be_fork.contracts fc
        LEFT JOIN public.contracts pubc ON (
          NULLIF(TRIM(COALESCE(fc.po_number::text, '')), '') IS NOT NULL
          AND TRIM(COALESCE(pubc.po_number::text, '')) = TRIM(COALESCE(fc.po_number::text, ''))
        )
        WHERE fc.id = fo.contract_id
        LIMIT 1
      ), fo.contract_id)
    )
    WHERE fo.id = %1$s
    LIMIT 1
  ), (
    SELECT t.id FROM public.trucking_operations t WHERE t.id = %1$s LIMIT 1
  ))$q$, p_expr);
$$;

-- LEFT JOIN to map fork rows onto existing public rows by business natural key (PO+STO, PO, etc.).
CREATE OR REPLACE FUNCTION be_fork.natural_key_join_sql(p_table text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE p_table
    WHEN 'sap_processed_data' THEN
      $j$LEFT JOIN public.sap_processed_data p ON (
        NULLIF(TRIM(COALESCE(r.po_number::text, '')), '') IS NOT NULL
        AND TRIM(COALESCE(p.po_number::text, '')) = TRIM(COALESCE(r.po_number::text, ''))
        AND COALESCE(NULLIF(TRIM(COALESCE(p.sto_number::text, '')), ''), '') =
            COALESCE(NULLIF(TRIM(COALESCE(r.sto_number::text, '')), ''), '')
      )$j$
    WHEN 'contracts' THEN
      $j$LEFT JOIN public.contracts p ON (
        NULLIF(TRIM(COALESCE(r.po_number::text, '')), '') IS NOT NULL
        AND TRIM(COALESCE(p.po_number::text, '')) = TRIM(COALESCE(r.po_number::text, ''))
      )$j$
    WHEN 'shipments' THEN
      $j$LEFT JOIN public.shipments p ON (
        p.shipment_id IS NOT DISTINCT FROM r.shipment_id
        AND p.contract_id = COALESCE((
          SELECT COALESCE(pubc.id, fc.id)
          FROM be_fork.contracts fc
          LEFT JOIN public.contracts pubc ON (
            NULLIF(TRIM(COALESCE(fc.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(pubc.po_number::text, '')) = TRIM(COALESCE(fc.po_number::text, ''))
          )
          WHERE fc.id = r.contract_id
          LIMIT 1
        ), r.contract_id)
      )$j$
    WHEN 'contract_stos' THEN
      $j$LEFT JOIN public.contract_stos p ON (
        p.sto_number IS NOT DISTINCT FROM r.sto_number
        AND p.contract_id = COALESCE((
          SELECT COALESCE(pubc.id, fc.id)
          FROM be_fork.contracts fc
          LEFT JOIN public.contracts pubc ON (
            NULLIF(TRIM(COALESCE(fc.po_number::text, '')), '') IS NOT NULL
            AND TRIM(COALESCE(pubc.po_number::text, '')) = TRIM(COALESCE(fc.po_number::text, ''))
          )
          WHERE fc.id = r.contract_id
          LIMIT 1
        ), r.contract_id)
      )$j$
    WHEN 'pre_planned_groups' THEN
      $j$LEFT JOIN public.pre_planned_groups p ON (
        p.group_code IS NOT DISTINCT FROM r.group_code
      )$j$
    WHEN 'pre_planned_group_members' THEN
      $j$LEFT JOIN public.pre_planned_group_members p ON (
        (
          r.released_at IS NULL
          AND p.released_at IS NULL
          AND p.contract_id = COALESCE((
            SELECT COALESCE(pubc.id, fc.id)
            FROM be_fork.contracts fc
            LEFT JOIN public.contracts pubc ON (
              NULLIF(TRIM(COALESCE(fc.po_number::text, '')), '') IS NOT NULL
              AND TRIM(COALESCE(pubc.po_number::text, '')) = TRIM(COALESCE(fc.po_number::text, ''))
            )
            WHERE fc.id = r.contract_id
            LIMIT 1
          ), r.contract_id)
        )
        OR (
          p.group_id = COALESCE((
            SELECT COALESCE(pubg.id, fg.id)
            FROM be_fork.pre_planned_groups fg
            LEFT JOIN public.pre_planned_groups pubg ON (
              pubg.group_code IS NOT DISTINCT FROM fg.group_code
            )
            WHERE fg.id = r.group_id
            LIMIT 1
          ), r.group_id)
          AND p.contract_id = COALESCE((
            SELECT COALESCE(pubc.id, fc.id)
            FROM be_fork.contracts fc
            LEFT JOIN public.contracts pubc ON (
              NULLIF(TRIM(COALESCE(fc.po_number::text, '')), '') IS NOT NULL
              AND TRIM(COALESCE(pubc.po_number::text, '')) = TRIM(COALESCE(fc.po_number::text, ''))
            )
            WHERE fc.id = r.contract_id
            LIMIT 1
          ), r.contract_id)
        )
      )$j$
    WHEN 'trucking_daily_actuals' THEN
      $j$LEFT JOIN public.trucking_daily_actuals p ON (
        p.progress_date IS NOT DISTINCT FROM r.progress_date
        AND p.sto_number IS NOT DISTINCT FROM r.sto_number
        AND p.trucking_operation_id = $j$ || be_fork.remap_trucking_operation_id_expr('r.trucking_operation_id') || $j$
      )$j$
    WHEN 'trucking_realizations' THEN
      $j$LEFT JOIN public.trucking_realizations p ON (
        p.trucking_operation_id = $j$ || be_fork.remap_trucking_operation_id_expr('r.trucking_operation_id') || $j$
      )$j$
    WHEN 'trucking_wb_imports' THEN
      $j$LEFT JOIN public.trucking_wb_imports p ON (
        p.original_filename IS NOT DISTINCT FROM r.original_filename
        AND p.created_at IS NOT DISTINCT FROM r.created_at
      )$j$
    ELSE ''
  END;
$$;

CREATE OR REPLACE FUNCTION be_fork.fk_remap_expr(p_table text, p_column text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_ref_table text;
  v_row_alias text := 'r';
BEGIN
  SELECT ref_cls.relname
  INTO v_ref_table
  FROM pg_constraint c
  JOIN pg_class src_cls ON src_cls.oid = c.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src_cls.relnamespace
  JOIN pg_attribute src_a
    ON src_a.attrelid = c.conrelid
   AND src_a.attnum = ANY (c.conkey)
   AND NOT src_a.attisdropped
  JOIN pg_class ref_cls ON ref_cls.oid = c.confrelid
  JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
  WHERE c.contype = 'f'
    AND src_ns.nspname = 'public'
    AND src_cls.relname = p_table
    AND src_a.attname = p_column
    AND ref_ns.nspname = 'public'
    AND array_length(c.conkey, 1) = 1
  LIMIT 1;

  IF v_ref_table IS NULL THEN
    RETURN format('%s.%I', v_row_alias, p_column);
  END IF;

  CASE v_ref_table
    WHEN 'contracts' THEN
      RETURN format($q$COALESCE((
        SELECT COALESCE(pub.id, fc.id)
        FROM be_fork.contracts fc
        LEFT JOIN public.contracts pub ON (
          NULLIF(TRIM(COALESCE(fc.po_number::text, '')), '') IS NOT NULL
          AND TRIM(COALESCE(pub.po_number::text, '')) = TRIM(COALESCE(fc.po_number::text, ''))
        )
        WHERE fc.id = %1$I.%2$I
        LIMIT 1
      ), %1$I.%2$I)$q$, v_row_alias, p_column);
    WHEN 'shipments' THEN
      RETURN format($q$COALESCE((
        SELECT COALESCE(pub.id, fs.id)
        FROM be_fork.shipments fs
        LEFT JOIN public.shipments pub ON (
          pub.shipment_id IS NOT DISTINCT FROM fs.shipment_id
          AND pub.contract_id = COALESCE((
            SELECT COALESCE(pubc.id, fc.id)
            FROM be_fork.contracts fc
            LEFT JOIN public.contracts pubc ON (
              NULLIF(TRIM(COALESCE(fc.po_number::text, '')), '') IS NOT NULL
              AND TRIM(COALESCE(pubc.po_number::text, '')) = TRIM(COALESCE(fc.po_number::text, ''))
            )
            WHERE fc.id = fs.contract_id
            LIMIT 1
          ), fs.contract_id)
        )
        WHERE fs.id = %1$I.%2$I
        LIMIT 1
      ), %1$I.%2$I)$q$, v_row_alias, p_column);
    WHEN 'sap_data_imports' THEN
      RETURN format($q$COALESCE((
        SELECT COALESCE(pub.id, fi.id)
        FROM be_fork.sap_data_imports fi
        LEFT JOIN public.sap_data_imports pub ON (
          pub.import_date IS NOT DISTINCT FROM fi.import_date
          AND pub.import_timestamp IS NOT DISTINCT FROM fi.import_timestamp
        )
        WHERE fi.id = %1$I.%2$I
        LIMIT 1
      ), %1$I.%2$I)$q$, v_row_alias, p_column);
    WHEN 'sap_raw_data' THEN
      RETURN format($q$COALESCE((
        SELECT COALESCE(pub.id, fr.id)
        FROM be_fork.sap_raw_data fr
        LEFT JOIN public.sap_raw_data pub ON (
          pub.row_number = fr.row_number
          AND pub.import_id = COALESCE((
            SELECT COALESCE(pubi.id, ffi.id)
            FROM be_fork.sap_data_imports ffi
            LEFT JOIN public.sap_data_imports pubi ON (
              pubi.import_date IS NOT DISTINCT FROM ffi.import_date
              AND pubi.import_timestamp IS NOT DISTINCT FROM ffi.import_timestamp
            )
            WHERE ffi.id = fr.import_id
            LIMIT 1
          ), fr.import_id)
        )
        WHERE fr.id = %1$I.%2$I
        LIMIT 1
      ), %1$I.%2$I)$q$, v_row_alias, p_column);
    WHEN 'sap_processed_data' THEN
      RETURN format($q$COALESCE((
        SELECT COALESCE(pub.id, fp.id)
        FROM be_fork.sap_processed_data fp
        LEFT JOIN public.sap_processed_data pub ON (
          NULLIF(TRIM(COALESCE(fp.po_number::text, '')), '') IS NOT NULL
          AND TRIM(COALESCE(pub.po_number::text, '')) = TRIM(COALESCE(fp.po_number::text, ''))
          AND COALESCE(NULLIF(TRIM(COALESCE(fp.sto_number::text, '')), ''), '') =
              COALESCE(NULLIF(TRIM(COALESCE(pub.sto_number::text, '')), ''), '')
        )
        WHERE fp.id = %1$I.%2$I
        LIMIT 1
      ), %1$I.%2$I)$q$, v_row_alias, p_column);
    WHEN 'trucking_operations' THEN
      RETURN be_fork.remap_trucking_operation_id_expr(
        format('%I.%I', v_row_alias, p_column)
      );
    WHEN 'users' THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'be_fork' AND table_name = 'users'
      ) THEN
        RETURN format($q$COALESCE((
          SELECT pub.id
          FROM be_fork.users fu
          JOIN public.users pub ON pub.email IS NOT DISTINCT FROM fu.email
          WHERE fu.id = %1$I.%2$I
          LIMIT 1
        ), (
          SELECT u.id FROM public.users u WHERE u.id = %1$I.%2$I LIMIT 1
        ))$q$, v_row_alias, p_column);
      END IF;
      RETURN format($q$(
        SELECT u.id FROM public.users u WHERE u.id = %1$I.%2$I LIMIT 1
      )$q$, v_row_alias, p_column);
    WHEN 'trucking_wb_imports' THEN
      RETURN format($q$COALESCE((
        SELECT COALESCE(pub.id, fi.id)
        FROM be_fork.trucking_wb_imports fi
        LEFT JOIN public.trucking_wb_imports pub ON (
          pub.original_filename IS NOT DISTINCT FROM fi.original_filename
          AND pub.created_at IS NOT DISTINCT FROM fi.created_at
        )
        WHERE fi.id = %1$I.%2$I
        LIMIT 1
      ), %1$I.%2$I)$q$, v_row_alias, p_column);
    WHEN 'pre_planned_groups' THEN
      RETURN format($q$COALESCE((
        SELECT COALESCE(pub.id, fg.id)
        FROM be_fork.pre_planned_groups fg
        LEFT JOIN public.pre_planned_groups pub ON (
          pub.group_code IS NOT DISTINCT FROM fg.group_code
        )
        WHERE fg.id = %1$I.%2$I
        LIMIT 1
      ), %1$I.%2$I)$q$, v_row_alias, p_column);
    ELSE
      RETURN format('%s.%I', v_row_alias, p_column);
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION be_fork.merge_select_sql(p_table text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_select text;
  v_natural_join text;
BEGIN
  v_natural_join := be_fork.natural_key_join_sql(p_table);

  SELECT string_agg(
    CASE
      WHEN column_name = 'id' AND v_natural_join <> '' THEN
        'COALESCE(p.id, r.id) AS id'
      ELSE
        be_fork.fk_remap_expr(p_table, column_name) || format(' AS %I', column_name)
    END,
    ', ' ORDER BY ordinal_position
  )
  INTO v_select
  FROM information_schema.columns
  WHERE table_schema = 'be_fork' AND table_name = p_table;

  RETURN COALESCE(v_select, 'r.*');
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
  v_src_extra text;
  v_natural_join text;
  v_merge_select text;
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
  v_src_extra := coalesce(v_unique_filter, '');
  v_natural_join := be_fork.natural_key_join_sql(p_table);
  v_merge_select := be_fork.merge_select_sql(p_table);

  v_sql := format($q$
    WITH src_raw AS (
      SELECT b.* FROM be_fork.%1$I b
      WHERE b.%2$I >= $1%3$s
    ),
    src_mapped AS (
      SELECT %7$s
      FROM src_raw r
      %8$s
    ),
    src AS (
      SELECT DISTINCT ON (%5$s) src_mapped.*
      FROM src_mapped
      ORDER BY %5$s, %2$I DESC NULLS LAST
    ),
    upserted AS (
      INSERT INTO public.%1$I (%4$s)
      SELECT %4$s FROM src
      ON CONFLICT (%5$s) DO UPDATE SET
        %6$s
      WHERE COALESCE(public.%1$I.%2$I, 'epoch'::timestamptz)
        < COALESCE(EXCLUDED.%2$I, 'epoch'::timestamptz)
      RETURNING (xmax = 0) AS was_insert
    )
    SELECT
      COUNT(*) FILTER (WHERE was_insert),
      COUNT(*) FILTER (WHERE NOT was_insert)
    FROM upserted
  $q$,
    p_table,
    v_ts,
    v_src_extra,
    v_col_list,
    v_pk,
    v_set_clause,
    v_merge_select,
    v_natural_join
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
