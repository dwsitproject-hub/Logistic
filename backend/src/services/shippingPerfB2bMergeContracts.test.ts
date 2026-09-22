import { describe, expect, it } from 'vitest';
import { mergeShippingPerfStoGroup } from './shippingPerformance.service';

/**
 * A B2B origin's contract number must survive the STO merge.
 *
 * The main query relabels a kept B2B CHILD row to its ORIGIN's contract number - SAP raises the
 * shipment on the child, the voyage belongs to the origin, and dropping the child outright once
 * made both halves vanish from the page. `sto_metrics.contract_numbers`, built by
 * `all_sto_contract_links` from `contracts` alone, knows nothing of that relabelling. The merge
 * used to PREFER the sto_metrics list, so the origin's number was thrown away again right after
 * the query had gone to the trouble of writing it.
 *
 * Measured on the dev copy 2026-09-22: the page's SQL returned rows for origins 9194100034 and
 * 9334100045, and after the merge neither number appeared anywhere in the output.
 * `applyContractGrainOutstanding` keys on contract_number, so 3,200 MT and 1,800 MT were never
 * placed - 5,000 MT that Contract Performance counts and this page could not see.
 *
 * Dev has the data but only reaches this through a 70-second page run; the shape is built here
 * directly so a regression fails in milliseconds.
 */
const row = (over: Record<string, unknown>) => ({
  sto_key: '1006019499',
  shipment_id: '1006019499',
  sto_number: '1006019499',
  contract_number: 'C1',
  status: 'PLANNED',
  ...over,
});

describe('the STO merge keeps every contract on the group', () => {
  it('keeps a relabelled B2B ORIGIN number that sto_metrics does not carry', () => {
    const merged = mergeShippingPerfStoGroup([
      // sto_metrics knows this one, because it is a plain contract on the STO.
      row({ contract_number: '1004031380', contract_numbers: '1004031380', po_numbers: '1001031380' }),
      // These two are B2B origins the main query wrote in; sto_metrics never saw them.
      row({ contract_number: '9194100034', contract_numbers: '1004031380', po_numbers: '1001031380' }),
      row({ contract_number: '9334100045', contract_numbers: '1004031380', po_numbers: '1001031380' }),
    ]);

    const contracts = String(merged.contract_number).split(',').map((v) => v.trim());
    expect(contracts).toContain('9194100034');
    expect(contracts).toContain('9334100045');
    // and the one sto_metrics did know is still there
    expect(contracts).toContain('1004031380');
  });

  it('does not invent a contract when the two sources agree', () => {
    const merged = mergeShippingPerfStoGroup([
      row({ contract_number: 'C1', contract_numbers: 'C1, C2' }),
      row({ contract_number: 'C2', contract_numbers: 'C1, C2' }),
    ]);
    expect(String(merged.contract_number)).toBe('C1, C2');
  });

  it('still falls back to the rows when sto_metrics carries nothing', () => {
    const merged = mergeShippingPerfStoGroup([
      row({ contract_number: 'C1' }),
      row({ contract_number: 'C2' }),
    ]);
    expect(String(merged.contract_number)).toBe('C1, C2');
  });
});
