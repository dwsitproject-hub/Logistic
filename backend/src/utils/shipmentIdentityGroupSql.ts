/**
 * A PO / contract the Shipments toolbar names PICKS the groups (STO / operation) it belongs to; each picked group keeps ALL its members.
 *
 * The grouped list query used to carry the contract as a member-level WHERE, so the group held only the searched PO's shipment (BIO EXPRESS, OP-1004031705-93196222:
 * one PO of two, the other's quantity missing). Dropping it from the WHERE alone makes every request scan every shipment of the scope (80-180 s on the dev copy), because
 * the contract predicate was also what let the planner reach the few shipments by index. So the work is split:
 *
 *   1. identity_group_keys_N  - the list keys of the shipments the identity predicate matches (the old narrowed shape, keys only: no aggregates, no ports, no ATA joins);
 *   2. a membership test      - the row's own list key is one of those keys (exact);
 *   3. a candidate prune      - a SUPERSET of the shipments that can carry one of those keys, written so indexes serve it (shipment_id / operation_id / the contracts that host the STO).
 *
 * (3) only has to be a superset: (2) decides. A shipment's list key is COALESCE(vessel STO pick, numeric shipment_id, contract.sto_number, latest SAP effective_sto,
 * operation_id, shipment_id, id::text) - see shipmentListSeaStoKeyExpr - so a member of key K matches K through one of those columns of its own or of its (B2B-remapped) contract.
 */

/** The CTE that lists the keys of the groups the identity predicate picks. `fromJoinsSql` / `whereSql` are the main query's own, so the same scope applies. */
export function sqlIdentityGroupKeysCte(
  name: string,
  opts: { listStoKeySql: string; fromJoinsSql: string; scopeWhereSql: string; identityRowSql: string; b2bChildExcludeSql: string },
): string {
  return `${name} AS (
        SELECT DISTINCT NULLIF(TRIM((${opts.listStoKeySql})::text), '') AS sto_key
        FROM shipments s
        ${opts.fromJoinsSql}
        WHERE (${opts.scopeWhereSql})
          AND (${opts.identityRowSql})
          ${opts.b2bChildExcludeSql}
      )`;
}

/** Exact test: the row's list key is a key of a picked group. */
export function sqlIdentityGroupMember(name: string, listStoKeySql: string): string {
  return `NULLIF(TRIM((${listStoKeySql})::text), '') = ANY(ARRAY(SELECT k.sto_key FROM ${name} k WHERE k.sto_key IS NOT NULL))`;
}

/**
 * Superset of the shipments that can belong to a picked group, reachable by index. Hosting contracts: the STO sits on contracts.sto_number, on a contract_stos line
 * or as the latest SAP effective_sto; a B2B child's shipments are listed under its origin, so the children of a hosting origin (reference PO = origin PO) are hosts too.
 */
export function sqlIdentityGroupCandidates(name: string): string {
  const keys = `ARRAY(SELECT k.sto_key FROM ${name} k WHERE k.sto_key IS NOT NULL)`;
  return `(
          s.id::text = ANY(${keys})
          OR TRIM(s.shipment_id::text) = ANY(${keys})
          OR NULLIF(TRIM(s.operation_id::text), '') = ANY(${keys})
          OR s.contract_id = ANY(ARRAY(
            WITH idk_host AS (
              SELECT cc.id, cc.po_number
              FROM contracts cc
              WHERE NULLIF(TRIM(cc.sto_number::text), '') = ANY(${keys})
              UNION
              SELECT cc.id, cc.po_number
              FROM contract_stos cs
              JOIN contracts cc ON cc.id = cs.contract_id
              WHERE TRIM(cs.sto_number::text) = ANY(${keys})
              UNION
              SELECT cc.id, cc.po_number
              FROM contract_latest_spd_snapshot ls
              JOIN contracts cc ON cc.contract_id = ls.contract_number
              WHERE NULLIF(TRIM(ls.effective_sto), '') = ANY(${keys})
            )
            SELECT h.id FROM idk_host h
            UNION
            SELECT ch.id
            FROM idk_host h
            JOIN contract_latest_spd_snapshot lc ON NULLIF(TRIM(lc.contract_reference_po_raw), '') = NULLIF(TRIM(h.po_number::text), '')
            JOIN contracts ch ON ch.contract_id = lc.contract_number
          ))
        )`;
}
