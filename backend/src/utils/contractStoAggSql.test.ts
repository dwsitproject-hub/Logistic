import { buildStoAggCte, buildStoAggFromSnapshotCte, buildContractStoAggSnapshotRefreshSql } from './contractStoAggSql';

describe('contractStoAggSql', () => {
  it('buildStoAggCte supports contract_scope join', () => {
    const sql = buildStoAggCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });
    expect(sql).toContain('sto_agg AS (');
    expect(sql).toContain('INNER JOIN contract_scope cs');
    expect(sql).toContain('STRING_AGG(DISTINCT x.effective_sto');
    expect(sql).toContain("data->'contract'->>'sto_quantity'");
    expect(sql).toContain('DISTINCT ON (spd2.contract_number)');
    expect(sql).toContain('li.import_id IS NOT DISTINCT FROM spd.import_id');
  });

  it('buildStoAggCte supports in_subquery filter', () => {
    const sql = buildStoAggCte({
      kind: 'in_subquery',
      subquery: 'SELECT contract_id FROM contracts WHERE contract_id = ANY($1)',
    });
    expect(sql).toContain('contract_id FROM contracts WHERE contract_id = ANY($1)');
    expect(sql).not.toContain('INNER JOIN contract_scope');
  });

  it('buildStoAggFromSnapshotCte reads contract_sto_agg_snapshot scoped to list', () => {
    const sql = buildStoAggFromSnapshotCte('contract_scope');
    expect(sql).toContain('contract_sto_agg_snapshot');
    expect(sql).toContain('INNER JOIN contract_scope cs');
    expect(sql).toContain('sto_numbers');
    expect(sql).toContain('total_sto_quantity');
    expect(sql).toContain('sto_count');
  });

  it('buildContractStoAggSnapshotRefreshSql reuses live sto_agg builder', () => {
    const sql = buildContractStoAggSnapshotRefreshSql();
    expect(sql).toContain('INSERT INTO contract_sto_agg_snapshot');
    expect(sql).toContain('FROM sto_agg sa');
    expect(sql).toContain('SELECT contract_id FROM contracts');
  });
});
