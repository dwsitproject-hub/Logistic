/**
 * How far along the pipeline a shipment is, for "the furthest active stage wins when one PO sits
 * on multiple STOs".
 *
 * ONE definition, two renderings. The SQL builder below is generated from the same map the TS
 * function reads, because Shipments applies this rule in SQL and Shipping Performance needs to
 * apply the identical rule in TypeScript. Every discrepancy chased between those two pages on
 * 2026-09-18 and 09-21 was one rule with two spellings; this is the same rule in two languages,
 * which is the one case where a copy is unavoidable - so it is generated rather than written.
 */
const STAGE_RANKS: ReadonlyArray<readonly [number, readonly string[]]> = [
  [5, ['ARRIVED_DP', 'BERTHED_DP', 'UNLOADING']],
  [4, ['SAILED']],
  [3, ['ARRIVED_LP', 'BERTHED_LP', 'LOADING', 'COMPLETED_LOADING']],
  [2, ['PLANNED']],
];

/** Anything not listed - including COMPLETED and CANCELLED - ranks below every active stage. */
export const SHIPMENT_STAGE_RANK_OTHER = 1;

const RANK_BY_STATUS = new Map<string, number>(
  STAGE_RANKS.flatMap(([rank, statuses]) => statuses.map((s) => [s, rank] as const)),
);

export function shipmentActiveStageRank(status: string | null | undefined): number {
  return RANK_BY_STATUS.get(String(status ?? '').trim().toUpperCase()) ?? SHIPMENT_STAGE_RANK_OTHER;
}

/** True for the stages the Shipments OS cards count; COMPLETED and CANCELLED are not among them. */
export function isShipmentActiveStage(status: string | null | undefined): boolean {
  return shipmentActiveStageRank(status) > SHIPMENT_STAGE_RANK_OTHER;
}

export function sqlShipmentActiveStageRankExpr(effectiveStatusExpr: string): string {
  const whens = STAGE_RANKS.map(([rank, statuses]) => {
    const list = statuses.map((s) => `'${s}'`).join(', ');
    const test =
      statuses.length === 1
        ? `${effectiveStatusExpr} = ${list}`
        : `${effectiveStatusExpr} IN (${list})`;
    return `WHEN ${test} THEN ${rank}`;
  }).join('\n    ');
  return `CASE
    ${whens}
    ELSE ${SHIPMENT_STAGE_RANK_OTHER}
  END`;
}
