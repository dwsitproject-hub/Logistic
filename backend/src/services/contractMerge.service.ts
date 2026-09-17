import { PoolClient } from 'pg';
import logger from '../utils/logger';
import { contractSurvivorScore, normalizePoNumber } from '../utils/contractPoIdentity';
import { dedupeActiveTruckingOpsForContract } from './truckingDedupe.service';

export interface ContractRowRef {
  id: string;
  contract_id: string;
  po_number: string | null;
  status: string | null;
  updated_at: Date | string | null;
  created_at: Date | string | null;
}

/**
 * Move dependent rows from one contract UUID to another.
 */
export async function mergeContractRecords(
  client: PoolClient,
  fromContractUuid: string,
  toContractUuid: string,
): Promise<void> {
  if (fromContractUuid === toContractUuid) return;

  await client.query(`UPDATE shipments SET contract_id = $1 WHERE contract_id = $2`, [
    toContractUuid,
    fromContractUuid,
  ]);
  await client.query(`UPDATE trucking_operations SET contract_id = $1 WHERE contract_id = $2`, [
    toContractUuid,
    fromContractUuid,
  ]);
  await client.query(`UPDATE payments SET contract_id = $1 WHERE contract_id = $2`, [
    toContractUuid,
    fromContractUuid,
  ]);
  await client.query(`UPDATE documents SET contract_id = $1 WHERE contract_id = $2`, [
    toContractUuid,
    fromContractUuid,
  ]);
  await client.query(
    `UPDATE settlement_invoice_summaries SET contract_id = $1 WHERE contract_id = $2`,
    [toContractUuid, fromContractUuid],
  );
  await client.query(
    `INSERT INTO contract_stos (
       contract_id, sto_number, sto_quantity, sto_type, sto_item, sto_classification, plant_code
     )
     SELECT $1, sto_number, sto_quantity, sto_type, sto_item, sto_classification, plant_code
     FROM contract_stos
     WHERE contract_id = $2
     ON CONFLICT (contract_id, sto_number) DO UPDATE SET
       sto_quantity = COALESCE(EXCLUDED.sto_quantity, contract_stos.sto_quantity),
       sto_type = COALESCE(EXCLUDED.sto_type, contract_stos.sto_type),
       sto_item = COALESCE(EXCLUDED.sto_item, contract_stos.sto_item),
       sto_classification = COALESCE(EXCLUDED.sto_classification, contract_stos.sto_classification),
       plant_code = COALESCE(EXCLUDED.plant_code, contract_stos.plant_code),
       updated_at = CURRENT_TIMESTAMP`,
    [toContractUuid, fromContractUuid],
  );
  await client.query(`DELETE FROM contracts WHERE id = $1`, [fromContractUuid]);

  // After re-pointing trucking ops onto survivor, collapse siblings (WB-complete keeper).
  await dedupeActiveTruckingOpsForContract(client, toContractUuid);
}

export function pickContractSurvivor(rows: ContractRowRef[]): ContractRowRef {
  return [...rows].sort((a, b) => contractSurvivorScore(b) - contractSurvivorScore(a))[0];
}

/** Merge all contracts sharing the same PO into one survivor row. */
export async function mergeDuplicateContractsByPo(
  client: PoolClient,
  poNumber: string,
): Promise<string | null> {
  const po = normalizePoNumber(poNumber);
  if (!po) return null;

  const res = await client.query<ContractRowRef>(
    `SELECT id, contract_id, po_number, status, updated_at, created_at
     FROM contracts
     WHERE TRIM(COALESCE(po_number::text, '')) = TRIM($1::text)
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
    [po],
  );
  if (res.rows.length <= 1) return res.rows[0]?.id ?? null;

  const survivor = pickContractSurvivor(res.rows);
  for (const row of res.rows) {
    if (row.id === survivor.id) continue;
    logger.info('mergeDuplicateContractsByPo: merging contract into PO survivor', {
      po,
      from: row.contract_id,
      to: survivor.contract_id,
    });
    await mergeContractRecords(client, row.id, survivor.id);
  }
  return survivor.id;
}
