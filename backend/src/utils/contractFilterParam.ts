import { query } from '../database/connection';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sentinel used when a supplied contract identifier resolves to nothing.
 *
 * Returning "no filter" for an unresolvable id is the dangerous case: the caller asked for one
 * contract and would receive every row, presented as the answer. A value that cannot match a
 * real contract number makes the request return zero rows instead, which is the honest reply.
 */
const MATCHES_NOTHING = '__no_such_contract__';

/**
 * Resolves the contract filter for the shipment and trucking list endpoints.
 *
 * Those lists already filter server-side on `contract`, keyed on the contract NUMBER
 * (`contracts.contract_id`) — verified against staging data: `?contract=1584000902` returns 7
 * shipments where the database holds exactly 7. What they did not accept is `contractId` holding
 * a UUID, which Express parses and the query then ignores, so the request silently returned the
 * unfiltered list. That is what the MCP connector hit: a request for one contract's shipments
 * came back with all of them and no error raised anywhere.
 *
 * This accepts the aliases as well as the original, and takes either key type:
 *   - a contract number passes through unchanged
 *   - a UUID is resolved to its contract number, since that is what the lists filter on
 *   - an unresolvable UUID yields a sentinel that matches nothing, never "no filter"
 *
 * `contract` still wins when supplied, so existing callers are untouched.
 */
export async function resolveContractFilterParam(
  q: Record<string, unknown>,
): Promise<string | undefined> {
  const direct = q.contract;
  if (typeof direct === 'string' && direct.trim() !== '') return direct;

  const aliasRaw = q.contractId ?? q.contract_id;
  const alias = typeof aliasRaw === 'string' ? aliasRaw.trim() : '';
  if (!alias) return undefined;

  if (!UUID_RE.test(alias)) return alias;

  const result = await query('SELECT contract_id FROM contracts WHERE id = $1 LIMIT 1', [alias]);
  const contractNumber = result.rows[0]?.contract_id;
  const resolved = contractNumber == null ? '' : String(contractNumber).trim();
  return resolved === '' ? MATCHES_NOTHING : resolved;
}

/**
 * Applies {@link resolveContractFilterParam} onto the request query in place, so every downstream
 * consumer — filter builders and cache keys alike — sees one canonical `contract` value without
 * each of them having to know about the aliases.
 */
export async function applyContractFilterAlias(q: Record<string, unknown>): Promise<void> {
  const resolved = await resolveContractFilterParam(q);
  if (resolved !== undefined) q.contract = resolved;
}
