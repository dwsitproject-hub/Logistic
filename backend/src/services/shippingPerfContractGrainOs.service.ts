import { getClient } from '../database/connection';
import { sqlContractExecutionOutstandingKgExpr } from '../utils/contractExecutionOutstandingSql';
import { resolveContractsQtyMoveCte } from './contractQtyMoveSnapshot.service';
import {
  isShipmentActiveStage,
  shipmentActiveStageRank,
} from '../utils/shipmentActiveStageRank';

/**
 * Make Shipping Performance's aggregates count what Shipments counts.
 *
 * THE PROBLEM, measured rather than argued. Shipments values a CONTRACT's outstanding once any of
 * its shipments reaches an active stage, and places all of it on the furthest stage. This page
 * gives each STO a SHARE of its PO's outstanding. When a contract's other STOs are completed, or
 * fall outside the period or the site, their share is never counted here - so the same slice read
 * 79,914 MT against 81,583 on Shipments (CPO / BONTANG / YTD, production 2026-09-21), the last
 * 1,661 MT of a 31,832 MT gap.
 *
 * WHY NOT A REMAINDER ROW, which was the first plan. Reconciling per contract needs each row's
 * outstanding split across the contracts it carries, and a merged STO row can carry several. Any
 * split is an invention: a diagnosis that divided evenly produced ten contracts "over-counted" by
 * exactly the same few values (684, 634, 3,833 MT), which was the even split showing through, not
 * the data. A remainder computed against an invented split moves the arbitrariness rather than
 * removing it.
 *
 * WHAT THIS DOES INSTEAD. Each contract's outstanding is placed, whole, on the one row carrying
 * its furthest active stage - the rule Shipments already applies (sqlShipmentActiveStageRankExpr,
 * shared, not copied). Every contract lands on exactly one row, so:
 *   - the total equals Shipments by construction, not by subtraction
 *   - the drilldown stays additive: no contract straddles two nodes
 *   - nothing is apportioned, so no split has to be invented
 *
 * ONLY `outstanding_qty_aggregate` is rewritten. That field means "the value to use in
 * aggregates", and the frontend prefers it. `outstanding_qty` is untouched, so the view table
 * still shows each STO's own outstanding - the column Ryan asked to keep as OS Qty.
 */

/** Rows must expose these; everything else on the row is left alone. */
export type ContractGrainOsRow = Record<string, unknown> & {
  contract_number?: unknown;
  status?: unknown;
  /**
   * The stage narrowed to the row's OWN STO. `status` is a MAX across the STO group, so one
   * finished voyage marks the whole group COMPLETED and drops contracts whose own shipment has
   * not sailed - see mergeShippingPerfStoGroup. Shipments makes the same split.
   */
  os_status?: unknown;
  outstanding_qty_aggregate?: unknown;
  is_unplanned_backlog?: unknown;
};

/** The stage that decides outstanding: own-STO when the merge computed one, else the row's. */
export function osStageOf(row: ContractGrainOsRow): string {
  const own = String(row.os_status ?? '').trim();
  return own || String(row.status ?? '').trim();
}

/** Small enough that one bad chunk is cheap to lose, large enough to keep the round trips few. */
const CONTRACT_OS_CHUNK = 400;
/** Postgres kills a chunk that goes bad; the caller's timeout is the backstop, not the only one. */
const CONTRACT_OS_STATEMENT_TIMEOUT_MS = 20_000;

export function contractNumbersOf(row: ContractGrainOsRow): string[] {
  return String(row.contract_number ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** One B2B link: the child contract, its ORIGIN (parent), and whether SAP moves the parent at all. */
export type B2bOriginLink = { child: string; origin: string; parentHasQtyMove: boolean };

/**
 * Parent first, child only when the parent has NO movement record at all - Ryan's rule, exactly.
 *
 * WHY THIS EXISTS RATHER THAN A COMMENT SAYING IT CANNOT HAPPEN. The STO merge now UNIONS the
 * contract numbers `sto_metrics` knows with the ones the rows carry, because preferring one source
 * silently discarded relabelled B2B origins - 5,000 MT invisible on the dev copy, 2026-09-22. A
 * union can, in principle, name a child AND its origin on the same STO, and B2B double counting is
 * exactly how outstanding ballooned here before. That is why the page picks one side at all.
 *
 * Measured right after the union landed: **0** of 566 B2B pairs on dev had both sides valued,
 * including the 6 where the origin has a shipment of its own. So this guard fires on nothing
 * today. It is structural insurance, not a fix for an observed fault - nothing in the query
 * FORBIDS the shape, and "the data does not currently do that" is a weaker guarantee than these
 * totals deserve.
 *
 * ZERO IS NOT NULL, and the first version of this guard conflated them. It dropped the child only
 * when the parent's outstanding was above 0, so a parent that had been fully delivered handed the
 * family over to its child - and on the dev copy 49 such pairs exist carrying 17,402 MT, where the
 * PARENT holds the movement (4,500 delivered, 4,500 received) and the child is an empty duplicate
 * (0 / 0). Falling back there would have inflated outstanding by that whole amount.
 *
 * So the fallback keys on whether the parent has a `contract_qty_move_snapshot` row at all. On the
 * dev copy, 2026-09-22: **0 of 566** B2B parents lack one, so the child is in practice never the
 * source today - the branch is kept because the rule is Ryan's and a future SAP shape may need it,
 * not because anything currently uses it.
 */
export function applyB2bParentPreference(
  osByContract: Map<string, number>,
  links: ReadonlyArray<B2bOriginLink>,
): Map<string, number> {
  for (const { child, parentHasQtyMove } of links) {
    if (!osByContract.has(child)) continue;
    if (parentHasQtyMove) osByContract.delete(child);
  }
  return osByContract;
}

/** The B2B child -> origin links among the given contracts, read once from the SPD snapshot. */
async function loadB2bOriginLinks(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  contractIds: string[],
): Promise<B2bOriginLink[]> {
  const result = await client.query(
    `SELECT l.contract_number AS child,
            o.contract_id AS origin,
            EXISTS (
              SELECT 1 FROM contract_qty_move_snapshot q
              WHERE q.contract_number = o.contract_id
            ) AS parent_has_qty_move
     FROM contract_latest_spd_snapshot l
     JOIN contracts o
       ON NULLIF(TRIM(o.po_number::text), '') = NULLIF(TRIM(l.contract_reference_po_raw), '')
     WHERE l.contract_number = ANY($1::text[])
       AND UPPER(TRIM(COALESCE(l.b2b_flag_raw, ''))) = 'B2B'
       AND NULLIF(TRIM(l.contract_reference_po_raw), '') IS NOT NULL`,
    [contractIds],
  );
  return (
    result.rows as { child: string; origin: string; parent_has_qty_move: boolean }[]
  ).map((r) => ({
    child: String(r.child),
    origin: String(r.origin),
    parentHasQtyMove: r.parent_has_qty_move === true,
  }));
}

/**
 * The contract's outstanding, valued exactly as the Shipments execution arm values it.
 * Returns kg keyed by contract number; contracts with nothing outstanding are simply absent.
 */
export async function loadContractExecutionOutstandingKg(
  contractNumbers: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(contractNumbers.map((c) => c.trim()).filter(Boolean))];
  if (ids.length === 0) return out;

  /*
   * in_subquery, not the default join_scope: there is no contract_scope CTE here. The expression
   * reads `FROM qty_move qm`, so without this CTE the query fails at runtime with 42P01 while
   * every string assertion still passes - the gap that took this page down once before.
   */
  const qtyMoveCte = await resolveContractsQtyMoveCte({
    kind: 'in_subquery',
    subquery: 'SELECT c_s.contract_id FROM contracts c_s WHERE c_s.contract_id = ANY($1::text[])',
  });

  /*
   * CHUNKED, and bounded by the server's own clock.
   *
   * The whole page's contracts went in as one array - thousands of ids, spliced into both the
   * qty_move CTE and the outer WHERE, around an expression that is itself two correlated
   * subqueries per row. On production that stopped coming back, and because the refresh had no
   * timeout the page went down with it.
   *
   * statement_timeout is what makes this safe rather than merely smaller: a chunk that goes bad
   * is killed by Postgres instead of being waited on, so the caller's timeout is the backstop and
   * not the only defence.
   */
  /*
   * statement_timeout goes on its OWN statement, on a dedicated client.
   *
   * Putting it in front of the SELECT as `SET LOCAL ...; WITH ...` fails with "cannot insert
   * multiple commands into a prepared statement": the SELECT takes a parameter, so it goes
   * through the extended protocol, which allows exactly one command. That was caught by running
   * this - it would otherwise have been a second outage with a new cause.
   */
  const client = await getClient();
  try {
    await client.query(`SET statement_timeout = ${CONTRACT_OS_STATEMENT_TIMEOUT_MS}`);
    for (let i = 0; i < ids.length; i += CONTRACT_OS_CHUNK) {
      const chunk = ids.slice(i, i + CONTRACT_OS_CHUNK);
      const result = await client.query(
        `WITH ${qtyMoveCte}
         SELECT c.contract_id,
                (${sqlContractExecutionOutstandingKgExpr('c.contract_id')})::numeric AS os_kg
         FROM contracts c
         WHERE c.contract_id = ANY($1::text[])`,
        [chunk],
      );
      for (const row of result.rows as Record<string, unknown>[]) {
        const kg = Number(row.os_kg) || 0;
        if (kg > 0) out.set(String(row.contract_id), kg);
      }
    }
    /*
     * The links are read against the WHOLE id list, not the chunk. A parent and its child can
     * easily land in different chunks of 400, and a guard that only looked inside one chunk would
     * pass every test and still let the pair through in production.
     */
    applyB2bParentPreference(out, await loadB2bOriginLinks(client, ids));
  } finally {
    // Reset before returning it to the pool, or every later query on this connection inherits it.
    try {
      await client.query('SET statement_timeout = DEFAULT');
    } catch {
      /* the connection is going back to the pool either way */
    }
    client.release();
  }
  return out;
}

/**
 * Place each contract's outstanding on its furthest-active-stage row and clear it everywhere else.
 *
 * Backlog rows are left exactly as they are: they already carry a whole contract's outstanding,
 * they have no shipment and therefore no stage, and both pages already agree on that arm to the
 * MT because both call contractBacklogCoreWhereSql.
 */
export function applyContractGrainOutstanding<T extends ContractGrainOsRow>(
  rows: T[],
  contractOsKg: Map<string, number>,
): T[] {
  const winnerByContract = new Map<string, { row: T; rank: number }>();

  for (const row of rows) {
    if (row.is_unplanned_backlog === true) continue;
    const stage = osStageOf(row);
    const rank = shipmentActiveStageRank(stage);
    if (!isShipmentActiveStage(stage)) continue;
    for (const contract of contractNumbersOf(row)) {
      if (!contractOsKg.has(contract)) continue;
      const held = winnerByContract.get(contract);
      // Strictly greater, so the first row seen wins a tie and the result does not depend on
      // row order changing between runs.
      if (!held || rank > held.rank) winnerByContract.set(contract, { row, rank });
    }
  }

  const awarded = new Map<T, number>();
  for (const [contract, { row }] of winnerByContract) {
    awarded.set(row, (awarded.get(row) ?? 0) + (contractOsKg.get(contract) ?? 0));
  }

  for (const row of rows) {
    if (row.is_unplanned_backlog === true) continue;
    row.outstanding_qty_aggregate = awarded.get(row) ?? 0;
  }
  return rows;
}
