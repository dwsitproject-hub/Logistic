import { describe, expect, it } from 'vitest';
import { query } from '../database/connection';
import { shipmentListSeaStoKeyExpr } from './shipmentStoTypeSql';
import {
  sqlIdentityGroupCandidates,
  sqlIdentityGroupKeysCte,
  sqlIdentityGroupMember,
} from './shipmentIdentityGroupSql';

const flat = (s: string) => s.replace(/\s+/g, ' ');

/**
 * A PO / contract the Shipments toolbar names picks the groups (STO / operation) it belongs to; each picked group keeps all its members. BIO EXPRESS,
 * OP-1004031705-93196222: the table showed one of its two POs while Edit Shipment showed both, because the contract was a member-level WHERE.
 */
describe('shipmentIdentityGroupSql', () => {
  const key = shipmentListSeaStoKeyExpr('c', 'l', 's');

  it('the keys CTE carries the identity predicate and the scope, and returns list keys only', () => {
    const sql = flat(
      sqlIdentityGroupKeysCte('idk', {
        listStoKeySql: key,
        fromJoinsSql: 'LEFT JOIN contracts c ON c.id = s.contract_id',
        scopeWhereSql: 'c.contract_date >= $1',
        identityRowSql: 'c.contract_id = $2',
        b2bChildExcludeSql: 'AND NOT (l.contract_number IS NOT NULL)',
      }),
    );
    expect(sql).toContain('idk AS (');
    expect(sql).toContain('c.contract_date >= $1');
    expect(sql).toContain('c.contract_id = $2');
    expect(sql).toContain('SELECT DISTINCT NULLIF(TRIM((');
    expect(sql).not.toMatch(/GROUP BY/i);
  });

  it('the membership test and the candidate prune both read the CTE', () => {
    expect(flat(sqlIdentityGroupMember('idk', key))).toContain('FROM idk k');
    const prune = flat(sqlIdentityGroupCandidates('idk'));
    for (const arm of ['s.id::text = ANY(', 'TRIM(s.shipment_id::text) = ANY(', 'TRIM(s.operation_id::text), \'\') = ANY(', 'cc.sto_number', 'contract_stos', 'effective_sto', 'contract_reference_po_raw']) {
      expect(prune).toContain(arm);
    }
  });

  it('RUNS against the database: a picked OP- group keeps every contract of its operation, by contract A or by contract B', async () => {
    const pick = await query(
      `SELECT s.operation_id, ARRAY_AGG(DISTINCT c.contract_id) AS contracts
         FROM shipments s JOIN contracts c ON c.id = s.contract_id
        WHERE s.operation_id LIKE 'OP-%' AND COALESCE(s.status, '') <> 'CANCELLED' AND s.shipment_id !~ '^[0-9]+$'
        GROUP BY s.operation_id
       HAVING COUNT(DISTINCT s.contract_id) > 1
        LIMIT 1`,
    );
    const row = pick.rows[0];
    if (!row) return;
    const op = row.operation_id as string;
    const contracts = row.contracts as string[];
    const keysOf = async (contractNo: string) => {
      const r = await query(
        `WITH idk AS (
           SELECT DISTINCT NULLIF(TRIM((${key})::text), '') AS sto_key
             FROM shipments s
             LEFT JOIN contracts c ON c.id = s.contract_id
             LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
            WHERE c.contract_id = $1)
         SELECT sto_key FROM idk`,
        [contractNo],
      );
      return r.rows.map((x) => x.sto_key as string);
    };
    for (const contractNo of contracts) expect(await keysOf(contractNo)).toContain(op);

    // members of the picked group, by the exact test and by the candidate prune: the prune must be a superset of the exact members
    const members = await query(
      `WITH idk AS (SELECT $1::text AS sto_key)
       SELECT COUNT(*) FILTER (WHERE ${sqlIdentityGroupMember('idk', key)})::int AS exact_members,
              COUNT(*) FILTER (WHERE ${sqlIdentityGroupMember('idk', key)} AND ${sqlIdentityGroupCandidates('idk')})::int AS exact_and_candidate,
              COUNT(DISTINCT c.contract_id) FILTER (WHERE ${sqlIdentityGroupMember('idk', key)})::int AS exact_contracts
         FROM shipments s
         LEFT JOIN contracts c ON c.id = s.contract_id
         LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
        WHERE COALESCE(s.status, '') <> 'CANCELLED'`,
      [op],
    );
    expect(members.rows[0].exact_members).toBeGreaterThan(1);
    expect(members.rows[0].exact_and_candidate).toBe(members.rows[0].exact_members);
    expect(members.rows[0].exact_contracts).toBeGreaterThanOrEqual(contracts.length);
  }, 180_000);
});
