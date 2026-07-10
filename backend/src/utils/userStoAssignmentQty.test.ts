import { describe, expect, it } from 'vitest';
import { stoQtyAssignedMtToKg, sqlUserStoQtyAssignedToKgSql } from './userStoAssignmentQty';

describe('userStoAssignmentQty', () => {
  it('converts MT input to kg for storage', () => {
    expect(stoQtyAssignedMtToKg(5000)).toBe(5_000_000);
    expect(stoQtyAssignedMtToKg(0)).toBe(0);
  });

  it('sql normalizes legacy MT assignments using contract qty heuristic', () => {
    const sql = sqlUserStoQtyAssignedToKgSql('u.sto_qty_assigned', 'pl.contract_qty');
    expect(sql).toContain('* 1000');
    expect(sql).toContain('pl.contract_qty');
  });
});
