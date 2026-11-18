import { describe, expect, it } from 'vitest';
import {
  describePrePlannedBlockers,
  PRE_PLANNED_MANUAL_RELEASABLE_HOLDER_SQL,
  PRE_PLANNED_RELEASABLE_HOLDER_SQL,
} from './prePlannedGroup.service';

describe('describePrePlannedBlockers: what the user reads', () => {
  it('says nothing when nothing blocks', () => {
    expect(describePrePlannedBlockers([])).toBeNull();
  });

  it('names every blocking group once per PO, with the way out', () => {
    const message = describePrePlannedBlockers([
      { po_number: '1001030838', group_code: 'PPM-BONTAN-023', status: 'ACCEPTED' },
      { contract_id: '1004031000', group_code: 'PPM-BONTAN-030', status: 'ACCEPTED' },
    ]);
    expect(message).toContain('PO 1001030838 is still in Preplanned group PPM-BONTAN-023 (ACCEPTED)');
    expect(message).toContain('PO 1004031000 is still in Preplanned group PPM-BONTAN-030 (ACCEPTED)');
    expect(message).toMatch(/Return that group to Unplanned/);
  });
});

describe('the manual grouping may release more than the nightly rebuild', () => {
  it('the rebuild rule is unchanged: it does not release a member of a group linked to a live shipment', () => {
    expect(PRE_PLANNED_RELEASABLE_HOLDER_SQL).toContain("pg.status IN ('SUGGESTED', 'SUPERSEDED', 'DISMISSED')");
    expect(PRE_PLANNED_RELEASABLE_HOLDER_SQL).toContain("IN ('CANCELLED', 'CANCELED')");
  });

  it('the manual rule includes the rebuild rule, plus an ACCEPTED group with a shipment link whose member has no live shipment of its own', () => {
    expect(PRE_PLANNED_MANUAL_RELEASABLE_HOLDER_SQL).toContain(PRE_PLANNED_RELEASABLE_HOLDER_SQL);
    const extra = PRE_PLANNED_MANUAL_RELEASABLE_HOLDER_SQL.replace(PRE_PLANNED_RELEASABLE_HOLDER_SQL, '');
    expect(extra).toContain("pg.status = 'ACCEPTED'");
    expect(extra).toContain('pg.shipment_id IS NOT NULL');
    expect(extra).toContain('NOT EXISTS');
    expect(extra).toContain('ls.contract_id = pgm.contract_id');
    expect(extra).toContain("NOT IN ('CANCELLED', 'CANCELED', 'UNPLANNED')");
  });

  it('an ACCEPTED group with NO shipment link is released by neither rule (it is Preplanned)', () => {
    // every ACCEPTED clause in both rules demands a shipment link
    const accepted = [...PRE_PLANNED_MANUAL_RELEASABLE_HOLDER_SQL.matchAll(/pg\.status = 'ACCEPTED'\s+AND pg\.shipment_id IS NOT NULL/g)];
    expect(accepted).toHaveLength(2);
    expect(PRE_PLANNED_MANUAL_RELEASABLE_HOLDER_SQL).not.toMatch(/pg\.status = 'ACCEPTED'\s+AND NOT EXISTS/);
  });
});
