import { describe, expect, it } from 'vitest';
import { sqlExcludeDhmDeleted, wantsExcludeDhmDeleted } from './dhmDeletedFilter';

describe('dhmDeletedFilter', () => {
  it('reads the opt-in flag from a query value', () => {
    for (const v of ['true', 'TRUE', '1', ' true ', ['true']]) expect(wantsExcludeDhmDeleted(v)).toBe(true);
    for (const v of [undefined, '', 'false', '0', 'yes', null, []]) expect(wantsExcludeDhmDeleted(v)).toBe(false);
  });

  it('builds the clause only when asked, and treats NULL as not deleted', () => {
    expect(sqlExcludeDhmDeleted(false)).toBe('');
    expect(sqlExcludeDhmDeleted(true)).toBe(' AND COALESCE(dhm_is_deleted, FALSE) IS NOT TRUE');
    expect(sqlExcludeDhmDeleted(true, 'p.dhm_is_deleted')).toBe(' AND COALESCE(p.dhm_is_deleted, FALSE) IS NOT TRUE');
  });
});
