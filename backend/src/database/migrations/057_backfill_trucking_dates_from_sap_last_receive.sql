-- SAP upload provides "Trucking Last/Start Receive Date", not trucking_completion_date.

-- Backfill trucking_operations from latest sap_processed_data per contract (contract_id or STO).



UPDATE trucking_operations t

SET

  trucking_completion_date = COALESCE(t.trucking_completion_date, sap.last_receive_date),

  trucking_start_date = COALESCE(t.trucking_start_date, sap.start_receive_date),

  status = CASE

    WHEN t.status = 'CANCELLED' THEN t.status

    WHEN COALESCE(t.trucking_completion_date, sap.last_receive_date) IS NOT NULL THEN 'COMPLETED'

    WHEN COALESCE(t.trucking_start_date, sap.start_receive_date) IS NOT NULL THEN 'IN_PROGRESS'

    ELSE t.status

  END,

  updated_at = CURRENT_TIMESTAMP

FROM contracts c

CROSS JOIN LATERAL (

  SELECT

    CASE

      WHEN v.last_receive_raw IS NULL OR length(trim(v.last_receive_raw)) < 6 THEN NULL

      WHEN trim(v.last_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.last_receive_raw)::date

      WHEN trim(v.last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.last_receive_raw), 'MM/DD/YY')

      WHEN trim(v.last_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(v.last_receive_raw), 'MM/DD/YYYY')

      ELSE NULL

    END AS last_receive_date,

    CASE

      WHEN v.start_receive_raw IS NULL OR length(trim(v.start_receive_raw)) < 6 THEN NULL

      WHEN trim(v.start_receive_raw) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN trim(v.start_receive_raw)::date

      WHEN trim(v.start_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}$' THEN to_date(trim(v.start_receive_raw), 'MM/DD/YY')

      WHEN trim(v.start_receive_raw) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(trim(v.start_receive_raw), 'MM/DD/YYYY')

      ELSE NULL

    END AS start_receive_date

  FROM (

    SELECT

      COALESCE(

        spd.data->'raw'->>'Trucking Last Receive Date',

        spd.data->>'Trucking Last Receive Date',

        spd.data->'trucking'->0->'data'->>'trucking_last_receive_date'

      ) AS last_receive_raw,

      COALESCE(

        spd.data->'raw'->>'Trucking Start Receive Date',

        spd.data->>'Trucking Start Receive Date',

        spd.data->'trucking'->0->'data'->>'trucking_start_receive_date'

      ) AS start_receive_raw

    FROM sap_processed_data spd

    WHERE (

      spd.contract_number = c.contract_id

      OR (

        NULLIF(TRIM(c.sto_number::text), '') IS NOT NULL

        AND spd.sto_number = NULLIF(TRIM(c.sto_number::text), '')

      )

    )

    ORDER BY spd.created_at DESC NULLS LAST

    LIMIT 1

  ) v

) sap

WHERE t.contract_id = c.id

  AND (

    sap.last_receive_date IS NOT NULL

    OR sap.start_receive_date IS NOT NULL

  )

  AND (

    (t.trucking_completion_date IS NULL AND sap.last_receive_date IS NOT NULL)

    OR (t.trucking_start_date IS NULL AND sap.start_receive_date IS NOT NULL)

    OR (

      t.status NOT IN ('COMPLETED', 'CANCELLED')

      AND sap.last_receive_date IS NOT NULL

    )

  );


