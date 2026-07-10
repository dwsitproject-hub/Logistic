import {
  buildLatestSpdCte,
  buildLatestSpdFromSnapshotCte,
  buildContractLatestSpdSnapshotRefreshSql,
} from './contractLatestSpdSql';

describe('contractLatestSpdSql', () => {
  it('buildLatestSpdCte supports contract_scope join', () => {
    const sql = buildLatestSpdCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });
    expect(sql).toContain('latest_spd AS (');
    expect(sql).toContain('INNER JOIN contract_scope cs');
    expect(sql).toContain('DISTINCT ON (spd.contract_number)');
    expect(sql).toContain('ORDER BY spd.contract_number, spd.created_at DESC NULLS LAST');
  });

  it('buildLatestSpdCte supports in_subquery filter', () => {
    const sql = buildLatestSpdCte({
      kind: 'in_subquery',
      subquery: 'SELECT contract_id FROM contracts WHERE contract_id = ANY($1)',
    });
    expect(sql).toContain('contract_id FROM contracts WHERE contract_id = ANY($1)');
    expect(sql).not.toContain('INNER JOIN contract_scope');
  });

  it('buildLatestSpdFromSnapshotCte reads contract_latest_spd_snapshot scoped to list', () => {
    const sql = buildLatestSpdFromSnapshotCte('contract_scope');
    expect(sql).toContain('contract_latest_spd_snapshot');
    expect(sql).toContain('INNER JOIN contract_scope cs');
    expect(sql).toContain('spd_created_at AS created_at');
  });

  it('buildLatestSpdCte uses deterministic tie-break on spd.id', () => {
    const sql = buildLatestSpdCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });
    expect(sql).toContain('spd.id DESC');
  });

  it('buildContractLatestSpdSnapshotRefreshSql uses deterministic tie-break on spd.id', () => {
    const sql = buildContractLatestSpdSnapshotRefreshSql();
    expect(sql).toContain('spd.id DESC');
  });
});
