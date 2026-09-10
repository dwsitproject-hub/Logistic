import { describe, expect, it } from 'vitest';
import { shipmentListSpdAggCtes } from './shipmentListSapAggSql';
import { buildShipmentListStoMetricsCte } from './shippingPerformanceStoMetricsSql';
import {
  SAP_DERIVED_COLUMN_NAMES,
  SPD_KEYED_PASSTHROUGH_COLUMNS,
} from './sapDerivedColumnSql';

/**
 * A budget, not a style rule.
 *
 * Every `data->...` in this chain re-detoasts the whole jsonb blob, and the chain runs per page
 * row. Measured on the dev copy (27,003 rows, 138 MB of TOAST), root-node buffers:
 *
 *   1 jsonb value per row                 85,402 buffers     1,477 ms
 *   23 jsonb values per row            1,864,385 buffers    14,922 ms
 *   the same 23 as stored columns          1,110 buffers        20 ms
 *
 * That is why the hydrate list call cost 206s against the shell's 25s on the same 668 rows. The
 * counts below are what the chain renders today; migration 162 moved a first group of fields to
 * stored columns, and the rest are still to move. The test exists so a new `data->` added to this
 * chain has to be a deliberate decision rather than an accident - if the count goes up, either
 * store the field or raise the number knowing what it costs.
 */
function countJsonbAccesses(sql: string): number {
  const noComments = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  const nested = noComments.match(/[a-z_]+\.data\s*->\s*'[^']+'\s*->>\s*'[^']+'/g) ?? [];
  const topLevel = noComments.match(/[a-z_]+\.data\s*->>\s*'[^']+'/g) ?? [];
  const sectionOnly = noComments.match(/[a-z_]+\.data\s*->\s*'[^']+'(?!\s*->>)/g) ?? [];
  return nested.length + topLevel.length + sectionOnly.length;
}

describe('Shipments SAP-join jsonb access budget', () => {
  it('the shell path touches no jsonb at all', () => {
    expect(countJsonbAccesses(shipmentListSpdAggCtes(true))).toBe(0);
  });

  it('the hydrate path stays within its budget', () => {
    const total = countJsonbAccesses(shipmentListSpdAggCtes(false));
    /* 1,076 before migration 162; 704 after the status group; 338 after the quantity group;
       254 once spd_keyed started carrying the quantity columns instead of only `data`. */
    expect(total).toBeLessThanOrEqual(254);
  });

  it('sto_metrics, the biggest contributor, stays within its budget', () => {
    const total = countJsonbAccesses(buildShipmentListStoMetricsCte('shipment_page'));
    // 885 before migration 162 (82% of the whole chain); 513 after the status group; 147 now.
    expect(total).toBeLessThanOrEqual(147);
  });

  it('reads off spd_keyed only the columns spd_keyed actually carries', () => {
    /**
     * `spd_keyed` passes a chosen set of stored columns down, so `sk.<column>` is valid for those
     * and invalid for every other - it would be SQL naming a column that does not exist.
     * TypeScript cannot catch that: the row-based helpers take a string alias. It was a real
     * mistake, not a hypothetical - the quantity helpers were being called with `'sk'` before the
     * source split, while the CTE still carried only `data`.
     */
    const sql = shipmentListSpdAggCtes(false);
    const carried = new Set<string>(SPD_KEYED_PASSTHROUGH_COLUMNS);
    for (const column of SAP_DERIVED_COLUMN_NAMES) {
      if (carried.has(column)) continue;
      expect(sql, `sk.${column} is read off a CTE that does not carry it`).not.toContain(
        `sk.${column}`,
      );
    }
  });

  it('spd_keyed selects every column it promises to carry, in both branches and the stub', () => {
    const full = shipmentListSpdAggCtes(false);
    const stub = shipmentListSpdAggCtes(true);
    /*
     * Scoped to the spd_keyed block: `spd` is also the table alias inside sto_metrics, where
     * reading these columns is legitimate, so counting them across the whole chain proves
     * nothing about the CTE's own select lists.
     */
    const start = full.indexOf('spd_keyed AS (');
    const spdKeyed = full.slice(start, full.indexOf('contract_ext_agg AS (', start));
    expect(start, 'spd_keyed CTE not found').toBeGreaterThan(-1);

    /*
     * Whole-name matches only. `raw_quantity_delivery` is a prefix of
     * `raw_quantity_delivery_trucking` and `..._vessel`, so a substring count reports 6 where the
     * answer is 2. This prefix family has now bitten twice; it is worth remembering.
     */
    const countColumn = (haystack: string, column: string) =>
      (haystack.match(new RegExp(`spd\\.${column}(?![a-z_])`, 'g')) ?? []).length;

    for (const column of SPD_KEYED_PASSTHROUGH_COLUMNS) {
      // Two UNION ALL branches, so two selects of each column.
      expect(countColumn(spdKeyed, column), `${column} in both branches`).toBe(2);
      /*
       * The stub must declare the same columns. Without that, a skipSapJoin=true page fails to
       * resolve a reference the shared expressions emit - the shape of the bug that once emptied
       * the whole Trucking page.
       */
      expect(stub, `${column} missing from the stub`).toContain(`AS ${column}`);
    }
  });
});
