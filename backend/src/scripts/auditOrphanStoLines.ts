/**
 * Audit: SAP STO lines that appear in NEITHER the Shipments page nor the Trucking page.
 *
 * Every SAP STO line is V (vessel) or T (truck):
 *   - Shipments shows a line only when STO Type <> 'T', the effective incoterm is CIF/FOB/CFR,
 *     and a non-cancelled shipment row exists for that STO.
 *   - Trucking shows a contract only when it has a trucking_operations row. Those are created by
 *     a user action from the Trucking "Unplanned" view - the SAP import never creates one.
 *
 * So a truck-leg STO on a sea contract that nobody materialised exists in SAP and is reachable
 * nowhere in KLIP. This report lists those lines so the volume can be reviewed BEFORE anything is
 * created, and re-run after each upload as a standing check.
 *
 * Read-only: it writes an .xlsx and touches no application data.
 *
 * Run:  npx ts-node src/scripts/auditOrphanStoLines.ts
 *       npx ts-node src/scripts/auditOrphanStoLines.ts --out ../docs/my-name.xlsx
 */

import * as path from 'path';
import * as XLSX from 'xlsx';
import { query } from '../database/connection';

/** Quantities are reported in MT (whole numbers), matching the agreed reporting standard. */
const KG_PER_MT = 1000;

const outArgIndex = process.argv.indexOf('--out');
const DEFAULT_OUT = path.resolve(
  __dirname,
  '../../../docs',
  `KLIP_Orphan_STO_Lines_${new Date().toISOString().slice(0, 10)}.xlsx`,
);
const OUT_PATH = outArgIndex > -1 && process.argv[outArgIndex + 1]
  ? path.resolve(process.argv[outArgIndex + 1])
  : DEFAULT_OUT;

/**
 * One row per (contract, STO) SAP line, with the same visibility rules the two pages apply.
 * Group Plant resolution mirrors latePerformance.service.ts / the Contract Performance page.
 */
const SQL_ORPHANS = `
  WITH pairs AS (
    SELECT
      TRIM(spd.contract_number) AS contract_number,
      TRIM(spd.sto_number) AS sto_number,
      TRIM(COALESCE(spd.po_number, '')) AS po_number,
      c.id AS contract_uuid,
      UPPER(TRIM(COALESCE(c.incoterm, ''))) AS incoterm,
      UPPER(TRIM(COALESCE(
        spd.data->'raw'->>'STO Type',
        spd.data->'raw'->>'STO Type ',
        spd.data->'contract'->>'sto_type',
        spd.data->'shipment'->>'sto_type',
        ''
      ))) AS sto_type,
      COALESCE(NULLIF(TRIM(c.product), ''), 'Blank') AS product,
      COALESCE(NULLIF(TRIM(c.supplier), ''), 'Unknown') AS supplier,
      COALESCE(NULLIF(TRIM(c.group_name), ''), 'Ungrouped') AS group_supplier,
      c.contract_date,
      c.delivery_end_date,
      UPPER(TRIM(COALESCE(c.status, ''))) AS contract_status,
      COALESCE(
        NULLIF(TRIM(pnc.group_plant), ''),
        NULLIF(TRIM(pna.group_plant), ''),
        'Blank'
      ) AS group_plant,
      NULLIF(REPLACE(REPLACE(COALESCE(spd.data->'contract'->>'sto_quantity', ''), ',', ''), ' ', ''), '')::numeric AS sto_quantity_kg
    FROM sap_processed_data spd
    JOIN contracts c ON TRIM(c.contract_id) = TRIM(spd.contract_number)
    LEFT JOIN LATERAL (
      SELECT mp.group_plant FROM master_plants mp
      WHERE TRIM(UPPER(COALESCE(mp.plant_code, ''))) = TRIM(UPPER(COALESCE(c.plant_code, '')))
        AND NULLIF(TRIM(mp.plant_name), '') IS NOT NULL
        AND NULLIF(TRIM(c.company_name), '') IS NOT NULL
        AND TRIM(UPPER(COALESCE(mp.company_name, ''))) = TRIM(UPPER(COALESCE(c.company_name, '')))
      ORDER BY mp.updated_at DESC NULLS LAST LIMIT 1
    ) pnc ON TRUE
    LEFT JOIN LATERAL (
      SELECT mp.group_plant FROM master_plants mp
      WHERE TRIM(UPPER(COALESCE(mp.plant_code, ''))) = TRIM(UPPER(COALESCE(c.plant_code, '')))
        AND NULLIF(TRIM(mp.plant_name), '') IS NOT NULL
      ORDER BY mp.updated_at DESC NULLS LAST LIMIT 1
    ) pna ON TRUE
    WHERE NULLIF(TRIM(spd.sto_number), '') IS NOT NULL
      AND c.sap_presence = 'PRESENT'
  ),
  vis AS (
    SELECT p.*,
      EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.contract_id = p.contract_uuid
          AND TRIM(COALESCE(s.shipment_id, '')) = p.sto_number
          AND COALESCE(s.status, '') <> 'CANCELLED'
      ) AS has_shipment_row,
      EXISTS (SELECT 1 FROM trucking_operations t WHERE t.contract_id = p.contract_uuid) AS has_trucking_op
    FROM pairs p
  )
  SELECT
    v.*,
    (v.sto_type <> 'T' AND v.incoterm IN ('CIF', 'FOB', 'CFR') AND v.has_shipment_row) AS visible_in_shipments,
    v.has_trucking_op AS visible_in_trucking,
    CASE
      WHEN v.sto_type = 'T' AND NOT v.has_trucking_op
        THEN 'Truck STO (Type T) with no trucking operation - Shipments filters Type T out, Trucking has no row'
      WHEN v.sto_type <> 'T' AND NOT v.has_shipment_row AND NOT v.has_trucking_op
        THEN 'Vessel STO (Type V) with no shipment row and no trucking operation'
      WHEN v.sto_type <> 'T' AND v.incoterm NOT IN ('CIF', 'FOB', 'CFR') AND NOT v.has_trucking_op
        THEN 'Incoterm not shown on Shipments (only CIF/FOB/CFR) and no trucking operation'
      ELSE 'Other'
    END AS reason
  FROM vis v
  WHERE NOT (v.sto_type <> 'T' AND v.incoterm IN ('CIF', 'FOB', 'CFR') AND v.has_shipment_row)
    AND NOT v.has_trucking_op
  ORDER BY v.sto_type, v.incoterm, v.po_number, v.sto_number
`;

type OrphanRow = {
  po_number: string;
  contract_number: string;
  sto_number: string;
  sto_type: string;
  incoterm: string;
  product: string;
  supplier: string;
  group_supplier: string;
  group_plant: string;
  contract_status: string;
  contract_date: string | null;
  delivery_end_date: string | null;
  sto_quantity_kg: string | number | null;
  has_shipment_row: boolean;
  reason: string;
};

const asMt = (kg: unknown): number | null => {
  const n = Number(kg);
  return Number.isFinite(n) ? Math.round(n / KG_PER_MT) : null;
};
const asDate = (v: unknown): string => (v ? String(v).slice(0, 10) : '');

function autoWidth(rows: Array<Record<string, unknown>>, headers: string[]) {
  return headers.map((h) => ({
    wch: Math.min(
      44,
      Math.max(h.length + 2, ...rows.map((r) => String(r[h] ?? '').length + 2), 10),
    ),
  }));
}

function sheetFrom(rows: Array<Record<string, unknown>>, headers: string[]) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws['!cols'] = autoWidth(rows, headers);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: headers.length - 1, r: rows.length } }) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return ws;
}

async function main() {
  const res = await query(SQL_ORPHANS);
  const rows = (res.rows || []) as OrphanRow[];
  const today = new Date().toISOString().slice(0, 10);

  const detail = rows.map((r) => ({
    'PO No': r.po_number || '',
    'Contract No': r.contract_number,
    'STO No': r.sto_number,
    'STO Type': r.sto_type || '(blank)',
    Incoterm: r.incoterm || '(blank)',
    Product: r.product,
    'Group Plant': r.group_plant,
    Supplier: r.supplier,
    'Group Supplier': r.group_supplier,
    'Contract Status': r.contract_status,
    'Contract Date': asDate(r.contract_date),
    'Delivery End': asDate(r.delivery_end_date),
    'STO Qty (MT)': asMt(r.sto_quantity_kg),
    'Has Shipment Row': r.has_shipment_row ? 'Yes' : 'No',
    'Why invisible': r.reason,
  }));
  const detailHeaders = Object.keys(
    detail[0] ?? {
      'PO No': '', 'Contract No': '', 'STO No': '', 'STO Type': '', Incoterm: '', Product: '',
      'Group Plant': '', Supplier: '', 'Group Supplier': '', 'Contract Status': '',
      'Contract Date': '', 'Delivery End': '', 'STO Qty (MT)': '', 'Has Shipment Row': '',
      'Why invisible': '',
    },
  );

  // Summary by STO type + incoterm.
  const byKey = new Map<string, { type: string; incoterm: string; lines: number; qty: number; pos: Set<string> }>();
  for (const r of rows) {
    const key = `${r.sto_type}|${r.incoterm}`;
    const cur = byKey.get(key) ?? { type: r.sto_type || '(blank)', incoterm: r.incoterm || '(blank)', lines: 0, qty: 0, pos: new Set<string>() };
    cur.lines += 1;
    cur.qty += Number(r.sto_quantity_kg) || 0;
    if (r.po_number) cur.pos.add(r.po_number);
    byKey.set(key, cur);
  }
  const summary = [...byKey.values()]
    .sort((a, b) => b.lines - a.lines)
    .map((g) => ({
      'STO Type': g.type,
      Incoterm: g.incoterm,
      'Invisible STO Lines': g.lines,
      'Distinct POs': g.pos.size,
      'STO Qty (MT)': Math.round(g.qty / KG_PER_MT),
    }));
  summary.push({
    'STO Type': 'TOTAL',
    Incoterm: '',
    'Invisible STO Lines': rows.length,
    'Distinct POs': new Set(rows.map((r) => r.po_number).filter(Boolean)).size,
    'STO Qty (MT)': Math.round(rows.reduce((s, r) => s + (Number(r.sto_quantity_kg) || 0), 0) / KG_PER_MT),
  });

  // Per-PO rollup so a reviewer can work PO by PO.
  const byPo = new Map<string, { po: string; contract: string; lines: number; t: number; v: number; qty: number }>();
  for (const r of rows) {
    const key = r.po_number || r.contract_number;
    const cur = byPo.get(key) ?? { po: r.po_number || '', contract: r.contract_number, lines: 0, t: 0, v: 0, qty: 0 };
    cur.lines += 1;
    if (r.sto_type === 'T') cur.t += 1;
    else cur.v += 1;
    cur.qty += Number(r.sto_quantity_kg) || 0;
    byPo.set(key, cur);
  }
  const poRollup = [...byPo.values()]
    .sort((a, b) => b.lines - a.lines)
    .map((g) => ({
      'PO No': g.po,
      'Contract No': g.contract,
      'Invisible STO Lines': g.lines,
      'Truck (T)': g.t,
      'Vessel (V)': g.v,
      'STO Qty (MT)': Math.round(g.qty / KG_PER_MT),
    }));

  const notes = [
    { Item: 'Report date', Detail: today },
    { Item: 'What this lists', Detail: 'SAP STO lines that appear in neither the Shipments page nor the Trucking page.' },
    { Item: 'Shipments visibility rule', Detail: "STO Type <> 'T' AND effective incoterm IN (CIF, FOB, CFR) AND a non-cancelled shipment row exists for that STO." },
    { Item: 'Trucking visibility rule', Detail: 'The contract has at least one trucking_operations row. These are created by a user action from the Trucking Unplanned view; the SAP import does not create them.' },
    { Item: 'Main cause', Detail: "Truck-leg STO lines (Type T) on sea contracts (CIF/FOB/CFR) that nobody materialised into a trucking operation." },
    { Item: 'Second cause', Detail: 'Vessel STO lines (Type V) with no shipment row - these should have produced a shipment and did not.' },
    { Item: 'Scope', Detail: "Only contracts with sap_presence = 'PRESENT' (SAP-withdrawn contracts excluded, same as every page)." },
    { Item: 'Quantity unit', Detail: 'STO Qty is MT (converted from the Kg stored in KLIP), rounded to whole numbers.' },
    { Item: 'Nothing was changed', Detail: 'This report is read-only. No trucking operation or shipment was created.' },
    { Item: 'If you approve a backfill', Detail: 'Creating trucking operations for the Type T lines will add UNPLANNED work items that affect Trucking counts, Outstanding Qty and Contract Performance denominators.' },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(summary, Object.keys(summary[0] ?? { 'STO Type': '' })), 'Summary');
  XLSX.utils.book_append_sheet(wb, sheetFrom(poRollup, Object.keys(poRollup[0] ?? { 'PO No': '' })), 'By PO');
  XLSX.utils.book_append_sheet(wb, sheetFrom(detail, detailHeaders), 'Invisible STO Lines');
  XLSX.utils.book_append_sheet(wb, sheetFrom(notes, ['Item', 'Detail']), 'Notes');
  XLSX.writeFile(wb, OUT_PATH);

  console.log(`Invisible STO lines: ${rows.length}`);
  for (const s of summary) {
    console.log(`  ${String(s['STO Type']).padEnd(6)} ${String(s.Incoterm).padEnd(8)} lines=${s['Invisible STO Lines']}  POs=${s['Distinct POs']}  qty=${s['STO Qty (MT)']} MT`);
  }
  console.log(`\nWritten: ${OUT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
