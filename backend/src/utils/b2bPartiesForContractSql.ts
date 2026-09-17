/**
 * Child POs for a B2B origin: Contract Reff PO = origin PO.
 * $1 = origin PO number.
 */
export const SQL_B2B_PARTIES_FOR_ORIGIN_PO = `
      WITH latest_spd AS (
        SELECT DISTINCT ON (contract_number) contract_number, data, created_at
        FROM sap_processed_data
        WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
        ORDER BY contract_number, created_at DESC NULLS LAST
      )
      SELECT
        c.contract_id,
        MAX(c.contract_date) AS contract_date,
        STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL AND c.po_number != '') AS po_numbers,
        MAX(COALESCE(l.data->'raw'->>'Contract Ext No', l.data->>'Contract Ext No')) AS contract_ext_no,
        MAX(COALESCE(NULLIF(TRIM(c.company_name), ''), l.data->'raw'->>'Buyer', l.data->>'Buyer')) AS company_name,
        MAX(COALESCE(
          NULLIF(TRIM(c.buyer), ''),
          NULLIF(TRIM(l.data->'raw'->>'Buyer'), ''),
          NULLIF(TRIM(l.data->>'Buyer'), ''),
          NULLIF(TRIM(c.company_name), '')
        )) AS buyer,
        MAX(c.supplier) AS supplier,
        MAX(COALESCE(NULLIF(TRIM(c.incoterm), ''), l.data->'contract'->>'incoterm', l.data->>'Incoterm')) AS incoterm,
        MAX(COALESCE(
          l.data->'raw'->>'Certification',
          l.data->'raw'->>'certification',
          l.data->>'Certification',
          l.data->>'certification'
        )) AS certification,
        MAX(qm.quantity_delivery) AS quantity_delivery,
        MAX(qm.quantity_receive) AS quantity_receive
      FROM contracts c
      LEFT JOIN latest_spd l ON l.contract_number = c.contract_id
      LEFT JOIN contract_qty_move_snapshot qm ON qm.contract_number = c.contract_id
      WHERE NULLIF(TRIM(COALESCE(
        l.data->'contract'->>'contract_reference_po',
        l.data->>'CONTRACT REFF PO',
        l.data->>'Contract Reff PO Ini',
        l.data->'raw'->>'Contract Reff PO Ini'
      )), '') = $1
      GROUP BY c.contract_id
      ORDER BY MAX(c.contract_date) DESC NULLS LAST
      LIMIT 200
`;
