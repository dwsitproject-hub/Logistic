import { describe, expect, it } from 'vitest';
import {
  buildListOrderByWithSapStoPriority,
  shouldPrioritizeSapStoRows,
  sqlSapStoPresentSortKey,
} from './listSapStoPrioritySql';

describe('listSapStoPrioritySql', () => {
  it('shouldPrioritizeSapStoRows is true for UNPLANNED and PLANNED only', () => {
    expect(shouldPrioritizeSapStoRows('UNPLANNED')).toBe(true);
    expect(shouldPrioritizeSapStoRows('planned')).toBe(true);
    expect(shouldPrioritizeSapStoRows('IN_PROGRESS')).toBe(false);
    expect(shouldPrioritizeSapStoRows('ALL')).toBe(false);
  });

  it('sqlSapStoPresentSortKey ranks non-empty STO before empty', () => {
    const sql = sqlSapStoPresentSortKey('tf.sto_number');
    expect(sql).toContain('tf.sto_number');
    expect(sql).toContain('THEN 0');
    expect(sql).toContain('ELSE 1');
  });

  it('buildListOrderByWithSapStoPriority prefixes STO sort for PLANNED', () => {
    const sql = buildListOrderByWithSapStoPriority(
      'fs.sto_number',
      'fs.created_at DESC',
      'PLANNED',
    );
    expect(sql).toContain('fs.sto_number');
    expect(sql).toContain('fs.created_at DESC');
  });

  it('buildListOrderByWithSapStoPriority leaves other statuses unchanged', () => {
    const primary = 'fs.created_at DESC';
    expect(buildListOrderByWithSapStoPriority('fs.sto_number', primary, 'SAILED')).toBe(primary);
  });
});
