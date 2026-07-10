/**
 * Audit PO / shipment / STO duplicates.
 * Usage: npx ts-node src/scripts/auditPoShipmentDuplicates.ts [poNumber]
 */
import { query } from '../database/connection';

const poFilter = process.argv[2]?.trim() || null;

async function auditPo(po: string) {
  console.log(`\n========== PO ${po} ==========`);

  const contracts = await query(
    `SELECT id, contract_id, po_number, sto_number, transport_mode, supplier, product, created_at
     FROM contracts
     WHERE TRIM(po_number) = $1 OR po_number ILIKE '%' || $1 || '%'
     ORDER BY contract_id`,
    [po],
  );
  console.log('\n--- contracts ---');
  console.table(contracts.rows);

  const sap = await query(
    `SELECT id, contract_number, sto_number, shipment_id, vessel_name, created_at,
      NULLIF(TRIM(COALESCE(data->'raw'->>'STO No.', data->'raw'->>'STO Number', data->'shipment'->>'sto_no')), '') AS sap_sto,
      NULLIF(TRIM(COALESCE(data->'raw'->>'PO No', data->'raw'->>'PO Number', data->'contract'->>'po_number')), '') AS sap_po
     FROM sap_processed_data
     WHERE TRIM(COALESCE(po_number::text, '')) = $1
        OR TRIM(COALESCE(data->'raw'->>'PO No', data->'raw'->>'PO Number', data->'contract'->>'po_number', '')) = $1
        OR contract_number IN (
          SELECT contract_id FROM contracts
          WHERE TRIM(po_number) = $1 OR po_number ILIKE '%' || $1 || '%'
        )
     ORDER BY created_at DESC
     LIMIT 50`,
    [po],
  );
  console.log('\n--- sap_processed_data ---');
  console.table(sap.rows);

  const shipments = await query(
    `SELECT s.id, s.shipment_id, s.operation_id, s.vessel_name, s.status, s.created_at,
      c.contract_id, c.po_number, c.sto_number,
      COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id) AS sto_key
     FROM shipments s
     JOIN contracts c ON s.contract_id = c.id
     LEFT JOIN LATERAL (
       SELECT NULLIF(TRIM(COALESCE(
         spd.sto_number::text,
         spd.data->'raw'->>'STO No.',
         spd.data->'raw'->>'STO Number',
         spd.data->'shipment'->>'sto_no'
       )), '') AS effective_sto
       FROM sap_processed_data spd
       WHERE spd.contract_number = c.contract_id
       ORDER BY spd.created_at DESC NULLS LAST
       LIMIT 1
     ) l ON TRUE
     WHERE TRIM(c.po_number) = $1 OR c.po_number ILIKE '%' || $1 || '%'
     ORDER BY s.created_at`,
    [po],
  );
  console.log('\n--- shipments (raw rows) ---');
  console.table(shipments.rows);

  const listGroups = await query(
    `WITH latest_spd_contract AS (
       SELECT DISTINCT ON (spd.contract_number)
         spd.contract_number,
         NULLIF(TRIM(COALESCE(
           spd.sto_number::text,
           spd.data->'raw'->>'STO No.',
           spd.data->'raw'->>'STO Number',
           spd.data->'shipment'->>'sto_no',
           spd.data->'contract'->>'sto_no'
         )), '') AS effective_sto,
         spd.created_at
       FROM sap_processed_data spd
       WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
       ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
     ),
     shipment_base AS (
       SELECT
         COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id) AS sto_key,
         MAX(COALESCE(c.sto_number::text, l.effective_sto)) AS sto_number,
         MAX(s.shipment_id) AS shipment_id,
         MAX(s.operation_id) AS operation_id,
         MAX(s.vessel_name) AS vessel_name,
         MAX(s.status) AS status,
         STRING_AGG(DISTINCT c.contract_id, ', ' ORDER BY c.contract_id) AS contract_numbers,
         STRING_AGG(DISTINCT c.po_number, ', ' ORDER BY c.po_number) FILTER (WHERE c.po_number IS NOT NULL) AS po_numbers,
         COUNT(*)::int AS raw_shipment_rows
       FROM shipments s
       LEFT JOIN contracts c ON s.contract_id = c.id
       LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
       WHERE TRIM(c.po_number) = $1 OR c.po_number ILIKE '%' || $1 || '%'
       GROUP BY COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id)
     )
     SELECT * FROM shipment_base ORDER BY sto_key`,
    [po],
  );
  console.log('\n--- shipments list groups (UI sto_key) ---');
  console.table(listGroups.rows);
}

async function auditGlobalDuplicates() {
  console.log('\n========== GLOBAL DUPLICATE AUDIT ==========');

  const dupShipmentsPerContract = await query(`
    SELECT c.po_number, c.contract_id, COUNT(*)::int AS shipment_count,
      STRING_AGG(s.shipment_id, ' | ' ORDER BY s.created_at) AS shipment_ids,
      STRING_AGG(COALESCE(c.sto_number::text, s.operation_id, s.shipment_id), ' | ' ORDER BY s.created_at) AS sto_or_keys,
      STRING_AGG(s.status, ' | ' ORDER BY s.created_at) AS statuses
    FROM shipments s
    JOIN contracts c ON s.contract_id = c.id
    WHERE c.contract_id IS NOT NULL
    GROUP BY c.id, c.po_number, c.contract_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, c.po_number NULLS LAST
    LIMIT 100
  `);
  console.log(`\n--- contracts with 2+ shipment rows (${dupShipmentsPerContract.rowCount} shown, max 100) ---`);
  console.table(dupShipmentsPerContract.rows);

  const dupPoListGroups = await query(`
    WITH latest_spd_contract AS (
      SELECT DISTINCT ON (spd.contract_number)
        spd.contract_number,
        NULLIF(TRIM(COALESCE(
          spd.sto_number::text,
          spd.data->'raw'->>'STO No.',
          spd.data->'raw'->>'STO Number',
          spd.data->'shipment'->>'sto_no',
          spd.data->'contract'->>'sto_no'
        )), '') AS effective_sto,
        spd.created_at
      FROM sap_processed_data spd
      WHERE spd.contract_number IS NOT NULL AND TRIM(spd.contract_number) != ''
      ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
    ),
    shipment_base AS (
      SELECT
        COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id) AS sto_key,
        c.po_number,
        c.contract_id,
        s.id AS shipment_uuid
      FROM shipments s
      LEFT JOIN contracts c ON s.contract_id = c.id
      LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
      WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIX')
    ),
    po_group_counts AS (
      SELECT
        TRIM(po_number) AS po_number,
        COUNT(DISTINCT sto_key) AS distinct_sto_groups,
        COUNT(*)::int AS raw_shipment_rows,
        STRING_AGG(DISTINCT sto_key, ', ' ORDER BY sto_key) AS sto_keys
      FROM shipment_base
      WHERE po_number IS NOT NULL AND TRIM(po_number) != ''
      GROUP BY TRIM(po_number)
      HAVING COUNT(DISTINCT sto_key) > 1
    )
    SELECT * FROM po_group_counts
    ORDER BY distinct_sto_groups DESC, raw_shipment_rows DESC
    LIMIT 100
  `);
  console.log(`\n--- POs with 2+ distinct STO groups on shipments list (${dupPoListGroups.rowCount} shown) ---`);
  console.table(dupPoListGroups.rows);

  const sapMultiStoPerContract = await query(`
    SELECT contract_number,
      COUNT(DISTINCT NULLIF(TRIM(COALESCE(
        sto_number::text,
        data->'raw'->>'STO No.',
        data->'raw'->>'STO Number',
        data->'shipment'->>'sto_no'
      )), ''))::int AS distinct_sto_in_sap,
      STRING_AGG(DISTINCT NULLIF(TRIM(COALESCE(
        sto_number::text,
        data->'raw'->>'STO No.',
        data->'raw'->>'STO Number',
        data->'shipment'->>'sto_no'
      )), ''), ', ' ORDER BY NULLIF(TRIM(COALESCE(
        sto_number::text,
        data->'raw'->>'STO No.',
        data->'raw'->>'STO Number',
        data->'shipment'->>'sto_no'
      )), '')) AS sto_numbers
    FROM sap_processed_data
    WHERE contract_number IS NOT NULL AND TRIM(contract_number) != ''
    GROUP BY contract_number
    HAVING COUNT(DISTINCT NULLIF(TRIM(COALESCE(
      sto_number::text,
      data->'raw'->>'STO No.',
      data->'raw'->>'STO Number',
      data->'shipment'->>'sto_no'
    )), '')) > 1
    ORDER BY distinct_sto_in_sap DESC
    LIMIT 50
  `);
  console.log(`\n--- contracts with multiple STO in SAP (${sapMultiStoPerContract.rowCount} shown) ---`);
  console.table(sapMultiStoPerContract.rows);
}

async function auditGlobalSummary() {
  const r1 = await query(`
    SELECT COUNT(*)::int AS c FROM (
      SELECT contract_id FROM shipments WHERE contract_id IS NOT NULL
      GROUP BY contract_id HAVING COUNT(*) > 1
    ) t`);
  const r2 = await query(`
    SELECT COALESCE(SUM(extra), 0)::int AS total_extra FROM (
      SELECT COUNT(*) - 1 AS extra FROM shipments WHERE contract_id IS NOT NULL
      GROUP BY contract_id HAVING COUNT(*) > 1
    ) t`);
  const r3 = await query(`
    SELECT COUNT(*)::int AS po_with_multi_sto FROM (
      WITH latest_spd_contract AS (
        SELECT DISTINCT ON (spd.contract_number)
          spd.contract_number,
          NULLIF(TRIM(COALESCE(
            spd.sto_number::text,
            spd.data->'raw'->>'STO No.',
            spd.data->'raw'->>'STO Number',
            spd.data->'shipment'->>'sto_no'
          )), '') AS effective_sto,
          spd.created_at
        FROM sap_processed_data spd
        WHERE spd.contract_number IS NOT NULL
        ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST
      ),
      shipment_base AS (
        SELECT
          COALESCE(c.sto_number::text, l.effective_sto, s.operation_id, s.shipment_id) AS sto_key,
          TRIM(c.po_number) AS po_number
        FROM shipments s
        LEFT JOIN contracts c ON s.contract_id = c.id
        LEFT JOIN latest_spd_contract l ON l.contract_number = c.contract_id
        WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIX')
      )
      SELECT po_number FROM shipment_base
      WHERE po_number IS NOT NULL AND po_number != ''
      GROUP BY po_number
      HAVING COUNT(DISTINCT sto_key) > 1
    ) x`);
  console.log('\n--- global summary ---');
  console.table({
    contracts_with_2plus_shipment_rows: r1.rows[0]?.c,
    extra_shipment_rows_beyond_one_per_contract: r2.rows[0]?.total_extra,
    pos_showing_multiple_sto_groups_on_list: r3.rows[0]?.po_with_multi_sto,
  });
}

async function main() {
  if (poFilter) {
    await auditPo(poFilter);
  }
  await auditGlobalDuplicates();
  await auditGlobalSummary();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
