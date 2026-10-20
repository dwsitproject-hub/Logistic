import { getClient } from '../database/connection';
import { sqlContractExecutionOutstandingKgExpr } from '../utils/contractExecutionOutstandingSql';
import {
  sqlContractHasResolvedRegionSiteExpr,
  sqlRegionSiteDisplayForContract,
} from '../utils/regionSiteSql';
import { resolveContractsQtyMoveCte } from './contractQtyMoveSnapshot.service';
import { buildShipmentPageSeaIncotermScopeSql } from '../utils/shipmentIncotermScope';
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
  /**
   * Contracts whose OWN shipment carries the discharge ATC in an operation-keyed group whose stage was narrowed (mergeShippingPerfStoGroup): the
   * ATC finishes them, so this row does not hold their outstanding.
   */
  os_finished_contracts?: unknown;
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
      /*
       * A contract whose incoterm is not CIF / FOB / CFR (LCO, FRC) is NOT counted: its outstanding is Trucking's, even when SAP files its B2B CHILD under
       * a vessel STO and the row therefore reaches this page. This page's row scope tests the contract that carries the shipment - the child - while
       * the contract numbers on the row, and so the contracts valued here, are the ORIGINS after the B2B relabel; Shipments and Contract Performance's
       * sea half test the origin. SIT 2026-10-20: BG. SEJAHTERA D35 (STO 1016011384), three LCO origins (1004032634 / 637 / 795, BEKASI) = 2,100 MT that
       * only this page counted. Only the VALUE is withheld: the row, its dates and the delay averages stay, so the vessel leg of those chains still
       * counts where it is measured in days.
       */
      /*
       * A contract whose Region/Site does not resolve is NOT counted.
       *
       * Contract Performance drops those rows outright (`hasResolvedRegionSite`) and Shipments
       * applies the same test through `requireResolvedRegionSite`, so Region/Site is the agreed
       * reference and this page was the only one still counting them. Measured against a copy of
       * production taken 2026-09-22: exactly one contract, 1004032347 at 1,000 MT, which is the
       * whole of the 1,001 MT by which Shipping Performance (81,414 MT) exceeded Contract
       * Performance (80,413 MT) on CPO / BONTANG / YTD.
       *
       * It reaches a site-filtered scope at all because outstanding is contract grain while the
       * drilldown filters at ROW grain: the contract's own site is blank, but its outstanding is
       * placed on the row carrying its furthest active stage, and that row's site is BONTANG.
       */
      const result = await client.query(
        `WITH ${qtyMoveCte}
         SELECT c.contract_id,
                (${sqlContractExecutionOutstandingKgExpr('c.contract_id')})::numeric AS os_kg
         FROM contracts c
         WHERE c.contract_id = ANY($1::text[])
           AND ${sqlContractHasResolvedRegionSiteExpr('c.contract_id', 'c.po_number')}
           AND ${buildShipmentPageSeaIncotermScopeSql('c')}`,
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
  contractAttrs?: Map<string, ContractScopeAttrs>,
): T[] {
  const winnerByContract = new Map<string, { row: T; rank: number }>();

  for (const row of rows) {
    if (row.is_unplanned_backlog === true) continue;
    const stage = osStageOf(row);
    const rank = shipmentActiveStageRank(stage);
    if (!isShipmentActiveStage(stage)) continue;
    const finishedHere = Array.isArray(row.os_finished_contracts) ? (row.os_finished_contracts as string[]) : [];
    for (const contract of contractNumbersOf(row)) {
      if (!contractOsKg.has(contract)) continue;
      if (finishedHere.includes(contract)) continue;
      const held = winnerByContract.get(contract);
      // Strictly greater, so the first row seen wins a tie and the result does not depend on
      // row order changing between runs.
      if (!held || rank > held.rank) winnerByContract.set(contract, { row, rank });
    }
  }

  const awarded = new Map<T, number>();
  const awardedContracts = new Map<T, Map<string, number>>();
  for (const [contract, { row }] of winnerByContract) {
    const kg = contractOsKg.get(contract) ?? 0;
    awarded.set(row, (awarded.get(row) ?? 0) + kg);
    const held = awardedContracts.get(row) ?? new Map<string, number>();
    held.set(contract, kg);
    awardedContracts.set(row, held);
  }

  for (const row of rows) {
    if (row.is_unplanned_backlog === true) continue;
    row.outstanding_qty_aggregate = awarded.get(row) ?? 0;
    if (contractAttrs) attachContractScope(row, awardedContracts.get(row), contractAttrs);
  }
  return rows;
}

/**
 * The contract-level attributes a toolbar filter can pick on. A STO row carries ONE value of each
 * (the picked contract's, or a comma list), so a filter chooses rows, not contracts.
 */
export type ContractScopeAttrs = {
  product: string | null;
  incoterm: string | null;
  source_type: string | null;
  supplier: string | null;
  group_name: string | null;
  plant_site: string | null;
  /** YYYY-MM-DD */
  contract_date: string | null;
};

/**
 * One group of the contracts of a STO row that share every attribute above. `outstanding_qty_aggregate`
 * is what this row was awarded for exactly these contracts (0 when another row holds their furthest
 * stage), so the groups of a row sum to the row's own aggregate.
 */
export type ContractScopeGroup = ContractScopeAttrs & {
  contract_number: string;
  outstanding_qty_aggregate: number;
};

const SCOPE_ATTR_KEYS: ReadonlyArray<keyof ContractScopeAttrs> = [
  'product',
  'incoterm',
  'source_type',
  'supplier',
  'group_name',
  'plant_site',
  'contract_date',
];

function scopeText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

/**
 * Does the row's own value of each attribute already say what the group's is? A list field (supplier,
 * group, source, date) holds every member's value joined by commas, so it counts when it contains
 * the group's.
 */
function rowDescribesGroup(row: Record<string, unknown>, attrs: ContractScopeAttrs): boolean {
  return SCOPE_ATTR_KEYS.every((key) => {
    const mine = (scopeText(row[key]) ?? '').toUpperCase();
    const theirs = (attrs[key] ?? '').toUpperCase();
    if (mine === theirs) return true;
    if (!theirs) return false;
    return mine.includes(theirs);
  });
}

/**
 * Split a STO row's contracts into groups of identical attributes, when - and only when - the row's
 * own single set of values does not already say what its contracts are.
 *
 * WHY. Outstanding is awarded per CONTRACT, but the page filters per ROW, and a row can carry
 * contracts of several products / suppliers / groups. Picking CPO kept a row with three CPO
 * contracts and one POME contract, and counted the POME one too: BONTANG / CPO read 83,758 MT here
 * against Contract Performance's 83,258. The row keeps its single attributes for display; this adds
 * what the page needs to tell its contracts apart.
 *
 * That covers two cases, both measured on the dev copy. Contracts that differ among themselves (CPO and
 * POME on one vessel). And ONE contract whose own attributes differ from the row's: a B2B child is
 * relabelled to its origin's contract number, but the row keeps the CHILD's supplier / group, so
 * filtering by supplier put 4,500 MT under the wrong supplier on BONTANG.
 *
 * Only rows that differ get it, so the payload is untouched for the large majority and a row without
 * `contract_scope` behaves exactly as before.
 */
export function attachContractScope<T extends ContractGrainOsRow>(
  row: T,
  awardedKgByContract: Map<string, number> | undefined,
  contractAttrs: Map<string, ContractScopeAttrs>,
): void {
  delete (row as Record<string, unknown>).contract_scope;
  const contracts = contractNumbersOf(row);
  if (contracts.length < 1) return;

  const groups = new Map<string, { attrs: ContractScopeAttrs; contracts: string[]; kg: number }>();
  for (const contract of contracts) {
    const known = contractAttrs.get(contract);
    // A contract the lookup did not find takes the row's own values, so it joins the row's group
    // rather than forming one of its own.
    const attrs = {} as ContractScopeAttrs;
    for (const key of SCOPE_ATTR_KEYS) {
      attrs[key] = scopeText(known ? known[key] : (row as Record<string, unknown>)[key]);
    }
    const identity = SCOPE_ATTR_KEYS.map((key) => (attrs[key] ?? '').toUpperCase()).join('|');
    const group = groups.get(identity) ?? { attrs, contracts: [], kg: 0 };
    group.contracts.push(contract);
    group.kg += awardedKgByContract?.get(contract) ?? 0;
    groups.set(identity, group);
  }
  if (groups.size < 2) {
    const only = [...groups.values()][0]!;
    if (rowDescribesGroup(row as Record<string, unknown>, only.attrs)) return;
  }

  (row as Record<string, unknown>).contract_scope = [...groups.values()].map(
    (group): ContractScopeGroup => ({
      ...group.attrs,
      contract_number: group.contracts.join(', '),
      outstanding_qty_aggregate: group.kg,
    }),
  );
}

/**
 * The attributes of these contracts, read once, chunked and bounded by the server's clock like the
 * outstanding lookup above. The Region/Site expression runs per contract (two correlated subqueries).
 */
export async function loadContractScopeAttributes(
  contractNumbers: string[],
): Promise<Map<string, ContractScopeAttrs>> {
  const out = new Map<string, ContractScopeAttrs>();
  const ids = [...new Set(contractNumbers.map((c) => c.trim()).filter(Boolean))];
  if (ids.length === 0) return out;

  const client = await getClient();
  try {
    await client.query(`SET statement_timeout = ${CONTRACT_OS_STATEMENT_TIMEOUT_MS}`);
    for (let i = 0; i < ids.length; i += CONTRACT_OS_CHUNK) {
      const chunk = ids.slice(i, i + CONTRACT_OS_CHUNK);
      const result = await client.query(
        `SELECT c.contract_id,
                c.product,
                c.incoterm,
                c.source_type,
                c.supplier,
                c.group_name,
                to_char(c.contract_date::date, 'YYYY-MM-DD') AS contract_date,
                COALESCE(${sqlRegionSiteDisplayForContract('c.contract_id', 'c.po_number')}, 'Blank') AS plant_site
         FROM contracts c
         WHERE c.contract_id = ANY($1::text[])`,
        [chunk],
      );
      for (const row of result.rows as Record<string, unknown>[]) {
        out.set(String(row.contract_id), {
          product: scopeText(row.product),
          incoterm: scopeText(row.incoterm),
          source_type: scopeText(row.source_type),
          supplier: scopeText(row.supplier),
          group_name: scopeText(row.group_name),
          plant_site: scopeText(row.plant_site),
          contract_date: scopeText(row.contract_date),
        });
      }
    }
  } finally {
    try {
      await client.query('SET statement_timeout = DEFAULT');
    } catch {
      /* the connection is going back to the pool either way */
    }
    client.release();
  }
  return out;
}
