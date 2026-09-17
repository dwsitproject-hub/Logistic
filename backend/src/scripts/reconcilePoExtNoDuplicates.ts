/**
 * Reconcile historical PO ↔ Contract Ext No duplicates.
 *
 *   npx ts-node src/scripts/reconcilePoExtNoDuplicates.ts           # dry-run report
 *   npx ts-node src/scripts/reconcilePoExtNoDuplicates.ts --apply   # merge duplicates
 *
 * Writes audit CSV to tmp/po-ext-reconcile-audit-<timestamp>.csv
 */
import * as fs from 'fs';
import * as path from 'path';
import pool from '../database/connection';
import logger from '../utils/logger';
import {
  extractContractExtNoFromSpdJson,
  isPlaceholderExtNo,
  normalizePoNumber,
} from '../utils/contractPoIdentity';
import {
  mergeContractRecords,
  mergeDuplicateContractsByPo,
  pickContractSurvivor,
  type ContractRowRef,
} from '../services/contractMerge.service';

const APPLY = process.argv.includes('--apply');

interface AuditRow {
  scenario: 'A_PO_MULTI_EXT' | 'A_PO_MULTI_CONTRACT' | 'B_EXT_MULTI_PO';
  po: string;
  ext_old: string;
  ext_new: string;
  survivor_contract_id: string;
  merged_contract_ids: string;
  action: 'report' | 'merged' | 'dry_run';
}

const auditRows: AuditRow[] = [];

function pushAudit(row: AuditRow): void {
  auditRows.push(row);
  console.log(
    `[${row.scenario}] po=${row.po} ext_old=${row.ext_old || '-'} ext_new=${row.ext_new || '-'} ` +
      `survivor=${row.survivor_contract_id} merged=${row.merged_contract_ids || '-'} action=${row.action}`,
  );
}

function writeAuditCsv(): string {
  const dir = path.resolve(process.cwd(), '..', 'tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `po-ext-reconcile-audit-${stamp}.csv`);
  const header = 'scenario,po,ext_old,ext_new,survivor_contract_id,merged_contract_ids,action';
  const lines = auditRows.map((r) =>
    [r.scenario, r.po, r.ext_old, r.ext_new, r.survivor_contract_id, r.merged_contract_ids, r.action]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  fs.writeFileSync(file, [header, ...lines].join('\n'), 'utf8');
  return file;
}

async function loadLatestExtPerContract(): Promise<Map<string, string>> {
  const res = await pool.query<{
    contract_uuid: string;
    data: unknown;
  }>(`
    SELECT DISTINCT ON (c.id)
      c.id::text AS contract_uuid,
      spd.data
    FROM contracts c
    INNER JOIN sap_processed_data spd
      ON TRIM(COALESCE(spd.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
    WHERE NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
    ORDER BY c.id, spd.updated_at DESC NULLS LAST, spd.created_at DESC NULLS LAST
  `);

  const map = new Map<string, string>();
  for (const row of res.rows) {
    const ext = extractContractExtNoFromSpdJson(row.data);
    if (ext && !isPlaceholderExtNo(ext)) {
      map.set(row.contract_uuid, ext.trim());
    }
  }
  return map;
}

/** Collect Ext Nos from SPD per PO (non-TBA) for multi-ext detection. */
async function loadExtsByPoFromSpd(): Promise<Map<string, Set<string>>> {
  const res = await pool.query<{ po_number: string; data: unknown }>(`
    SELECT TRIM(COALESCE(po_number::text, '')) AS po_number, data
    FROM sap_processed_data
    WHERE NULLIF(TRIM(COALESCE(po_number::text, '')), '') IS NOT NULL
  `);
  const byPo = new Map<string, Set<string>>();
  for (const row of res.rows) {
    const po = normalizePoNumber(row.po_number);
    if (!po) continue;
    const ext = extractContractExtNoFromSpdJson(row.data);
    if (!ext || isPlaceholderExtNo(ext)) continue;
    if (!byPo.has(po)) byPo.set(po, new Set());
    byPo.get(po)!.add(ext.trim());
  }
  return byPo;
}

async function reportPoMultiExt(extByContract: Map<string, string>): Promise<void> {
  const byPoContracts = new Map<string, Set<string>>();
  const contracts = await pool.query<ContractRowRef>(
    `SELECT id, contract_id, po_number, status, updated_at, created_at
     FROM contracts
     WHERE NULLIF(TRIM(COALESCE(po_number::text, '')), '') IS NOT NULL`,
  );
  for (const c of contracts.rows) {
    const po = normalizePoNumber(c.po_number);
    if (!po) continue;
    const ext = extByContract.get(c.id);
    if (!ext) continue;
    if (!byPoContracts.has(po)) byPoContracts.set(po, new Set());
    byPoContracts.get(po)!.add(ext);
  }
  for (const [po, exts] of byPoContracts) {
    if (exts.size > 1) {
      pushAudit({
        scenario: 'A_PO_MULTI_EXT',
        po,
        ext_old: [...exts].join('|'),
        ext_new: '',
        survivor_contract_id: '',
        merged_contract_ids: '',
        action: 'report',
      });
    }
  }

  const byPoSpd = await loadExtsByPoFromSpd();
  for (const [po, exts] of byPoSpd) {
    if (exts.size > 1 && !(byPoContracts.get(po)?.size && byPoContracts.get(po)!.size > 1)) {
      pushAudit({
        scenario: 'A_PO_MULTI_EXT',
        po,
        ext_old: [...exts].join('|'),
        ext_new: '(canonical=latest SPD; no contract merge needed)',
        survivor_contract_id: '',
        merged_contract_ids: '',
        action: 'report',
      });
    }
  }
}

/** Map child PO → origin PO for B2B rows (must never be merged away by Ext No cleanup). */
async function loadB2bChildOriginByPo(): Promise<Map<string, string>> {
  const res = await pool.query<{ po_number: string; origin_po: string }>(`
    SELECT
      TRIM(COALESCE(c.po_number::text, '')) AS po_number,
      NULLIF(TRIM(COALESCE(
        l.data->'contract'->>'contract_reference_po',
        l.data->>'CONTRACT REFF PO',
        l.data->>'Contract Reff PO Ini',
        l.data->'raw'->>'Contract Reff PO Ini',
        l.data->'raw'->>'CONTRACT REFF PO',
        ''
      )), '') AS origin_po
    FROM contracts c
    LEFT JOIN LATERAL (
      SELECT spd.data
      FROM sap_processed_data spd
      WHERE TRIM(COALESCE(spd.po_number::text, '')) = TRIM(COALESCE(c.po_number::text, ''))
         OR spd.contract_number = c.contract_id
      ORDER BY spd.updated_at DESC NULLS LAST, spd.created_at DESC NULLS LAST
      LIMIT 1
    ) l ON true
    WHERE NULLIF(TRIM(COALESCE(c.po_number::text, '')), '') IS NOT NULL
      AND UPPER(NULLIF(TRIM(COALESCE(
        l.data->'contract'->>'contract_type',
        l.data->>'B2B Flag',
        l.data->'raw'->>'B2B Flag',
        c.contract_type::text,
        ''
      )), '')) = 'B2B'
      AND NULLIF(TRIM(COALESCE(
        l.data->'contract'->>'contract_reference_po',
        l.data->>'CONTRACT REFF PO',
        l.data->>'Contract Reff PO Ini',
        l.data->'raw'->>'Contract Reff PO Ini',
        l.data->'raw'->>'CONTRACT REFF PO',
        ''
      )), '') IS NOT NULL
  `);
  const map = new Map<string, string>();
  for (const row of res.rows) {
    const po = normalizePoNumber(row.po_number);
    const origin = normalizePoNumber(row.origin_po);
    if (po && origin) map.set(po, origin);
  }
  return map;
}

function groupHasB2bParentChild(
  rows: ContractRowRef[],
  b2bChildToOrigin: Map<string, string>,
): boolean {
  const pos = new Set(
    rows.map((r) => normalizePoNumber(r.po_number)).filter((p): p is string => !!p),
  );
  for (const po of pos) {
    const origin = b2bChildToOrigin.get(po);
    if (origin && pos.has(origin)) return true;
  }
  return false;
}

async function reconcileExtMultiPo(extByContract: Map<string, string>): Promise<number> {
  const byExt = new Map<string, ContractRowRef[]>();
  const b2bChildToOrigin = await loadB2bChildOriginByPo();
  const contracts = await pool.query<ContractRowRef>(
    `SELECT id, contract_id, po_number, status, updated_at, created_at
     FROM contracts
     WHERE NULLIF(TRIM(COALESCE(po_number::text, '')), '') IS NOT NULL`,
  );
  for (const c of contracts.rows) {
    const ext = extByContract.get(c.id);
    if (!ext || isPlaceholderExtNo(ext)) continue;
    const key = ext.toUpperCase();
    if (!byExt.has(key)) byExt.set(key, []);
    byExt.get(key)!.push(c);
  }

  let merged = 0;
  for (const [extKey, rows] of byExt) {
    if (rows.length <= 1) continue;

    // B2B origin+child can share Ext No legally — never merge those pairs.
    if (groupHasB2bParentChild(rows, b2bChildToOrigin)) {
      pushAudit({
        scenario: 'B_EXT_MULTI_PO',
        po: rows.map((r) => r.po_number).join('|'),
        ext_old: extKey,
        ext_new: extKey,
        survivor_contract_id: '',
        merged_contract_ids: 'skipped_b2b_parent_child',
        action: 'report',
      });
      continue;
    }

    // Drop B2B children from merge candidates (keep them as separate POs).
    const eligible = rows.filter((r) => {
      const po = normalizePoNumber(r.po_number);
      return !po || !b2bChildToOrigin.has(po);
    });
    if (eligible.length <= 1) {
      pushAudit({
        scenario: 'B_EXT_MULTI_PO',
        po: rows.map((r) => r.po_number).join('|'),
        ext_old: extKey,
        ext_new: extKey,
        survivor_contract_id: '',
        merged_contract_ids: 'skipped_only_b2b_children_remain',
        action: 'report',
      });
      continue;
    }

    const spdPick = await pool.query<{ po_number: string }>(
      `SELECT TRIM(COALESCE(po_number::text, '')) AS po_number
       FROM sap_processed_data
       WHERE UPPER(TRIM(COALESCE(
         data->'raw'->>'Contract Ext No',
         data->>'Contract Ext No',
         ''
       ))) = $1
       ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [extKey],
    );
    const canonicalPo = normalizePoNumber(spdPick.rows[0]?.po_number);
    let survivor = canonicalPo
      ? eligible.find((r) => normalizePoNumber(r.po_number) === canonicalPo)
      : undefined;
    if (!survivor) survivor = pickContractSurvivor(eligible);

    const mergedIds: string[] = [];
    for (const row of eligible) {
      if (row.id === survivor.id) continue;
      mergedIds.push(row.contract_id);
      if (APPLY) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await mergeContractRecords(client, row.id, survivor.id);
          await client.query('COMMIT');
          merged++;
        } catch (e) {
          await client.query('ROLLBACK');
          logger.error('merge failed', e);
        } finally {
          client.release();
        }
      }
    }
    pushAudit({
      scenario: 'B_EXT_MULTI_PO',
      po: String(survivor.po_number ?? ''),
      ext_old: extKey,
      ext_new: extKey,
      survivor_contract_id: survivor.contract_id,
      merged_contract_ids: mergedIds.join('|'),
      action: APPLY ? 'merged' : 'dry_run',
    });
  }
  return merged;
}

async function reconcilePoMultiContract(): Promise<number> {
  const dups = await pool.query<{ po_norm: string }>(`
    SELECT TRIM(po_number::text) AS po_norm
    FROM contracts
    WHERE NULLIF(TRIM(po_number::text), '') IS NOT NULL
    GROUP BY TRIM(po_number::text)
    HAVING COUNT(*) > 1
  `);
  let merged = 0;
  for (const row of dups.rows) {
    const before = await pool.query<ContractRowRef>(
      `SELECT id, contract_id, po_number, status, updated_at, created_at
       FROM contracts
       WHERE TRIM(COALESCE(po_number::text, '')) = TRIM($1::text)`,
      [row.po_norm],
    );
    const survivor = pickContractSurvivor(before.rows);
    const mergedIds = before.rows
      .filter((r) => r.id !== survivor.id)
      .map((r) => r.contract_id);

    if (APPLY) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await mergeDuplicateContractsByPo(client, row.po_norm);
        await client.query('COMMIT');
        merged++;
      } catch (e) {
        await client.query('ROLLBACK');
        logger.error('PO merge failed', e);
      } finally {
        client.release();
      }
    }
    pushAudit({
      scenario: 'A_PO_MULTI_CONTRACT',
      po: row.po_norm,
      ext_old: '',
      ext_new: '',
      survivor_contract_id: survivor.contract_id,
      merged_contract_ids: mergedIds.join('|'),
      action: APPLY ? 'merged' : 'dry_run',
    });
  }
  return merged;
}

async function assertNoDuplicates(): Promise<void> {
  const poDup = await pool.query(`
    SELECT TRIM(po_number::text) AS po_norm, COUNT(*) AS c
    FROM contracts
    WHERE NULLIF(TRIM(po_number::text), '') IS NOT NULL
    GROUP BY TRIM(po_number::text)
    HAVING COUNT(*) > 1
  `);
  console.log(`Post-check: PO with multiple contracts = ${poDup.rows.length}`);

  const extByPo = await loadExtsByPoFromSpd();
  let multiExt = 0;
  for (const [, exts] of extByPo) {
    if (exts.size > 1) multiExt++;
  }
  console.log(`Post-check: PO with multiple non-TBA Ext No in SPD = ${multiExt} (UI uses latest)`);
}

async function main(): Promise<void> {
  console.log(APPLY ? 'APPLY mode' : 'DRY-RUN mode');
  const extByContract = await loadLatestExtPerContract();
  await reportPoMultiExt(extByContract);
  const poMerged = await reconcilePoMultiContract();
  const extMerged = await reconcileExtMultiPo(extByContract);
  if (APPLY) await assertNoDuplicates();
  const auditFile = writeAuditCsv();
  console.log(`Done. PO groups merged: ${poMerged}, Ext groups merged: ${extMerged}`);
  console.log(`Audit CSV: ${auditFile}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
