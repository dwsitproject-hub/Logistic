import { describe, expect, it } from 'vitest';
import { sqlCoalesceSapRawQtyFields, sqlNullIfSapQtyPlaceholder } from './sapQtyPlaceholderSql';

describe('sapQtyPlaceholderSql', () => {
  it('treats 0 / 0.00 / 0.000 as missing so COALESCE can fall through', () => {
    const expr = sqlNullIfSapQtyPlaceholder(`spd.data->'raw'->>'Quantity Delivery Trucking'`);
    expect(expr).toContain('^-?0+(\\.0*)?$');
    expect(expr).toContain('Quantity Delivery Trucking');
  });

  it('coalesces Quantity Delivery Trucking then Quantity Delivery', () => {
    const sql = sqlCoalesceSapRawQtyFields([
      `spd.data->'raw'->>'Quantity Delivery Trucking'`,
      `spd.data->'raw'->>'Quantity Delivery'`,
    ]);
    expect(sql.startsWith('COALESCE(')).toBe(true);
    expect(sql).toContain('Quantity Delivery Trucking');
    expect(sql).toContain('Quantity Delivery');
  });
});
