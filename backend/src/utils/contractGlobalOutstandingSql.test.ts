import { describe, expect, it } from 'vitest';
import {
  buildQtyMoveCte,
  sqlContractGlobalOutstandingExpr,
} from './contractGlobalOutstandingSql';

describe('contractGlobalOutstandingSql', () => {
  it('buildQtyMoveCte supports contract_scope join', () => {
    const sql = buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });
    expect(sql).toContain('contract_scope');
    expect(sql).toContain('latest_per_sto');
    expect(sql).toContain('quantity_delivery_trucking');
    expect(sql).toContain('quantity_delivery_vessel');
    expect(sql).toContain('deduped');
  });

  it('buildQtyMoveCte supports in_subquery filter', () => {
    const sql = buildQtyMoveCte({
      kind: 'in_subquery',
      subquery: 'SELECT contract_number FROM contract_candidates',
    });
    expect(sql).toContain('contract_candidates');
  });

  it('sqlContractGlobalOutstandingExpr uses qty_move receive/delivery per incoterm (Contracts list rules)', () => {
    const sql = sqlContractGlobalOutstandingExpr({
      contractQtyExpr: 'pl.contract_qty',
      incotermExpr: 'pl.incoterm',
      contractNumberExpr: 'pl.contract_number',
    });
    expect(sql).toContain('qty_move');
    expect(sql).toContain('quantity_receive');
    expect(sql).toContain('quantity_delivery');
    expect(sql).toContain("'FRC', 'CIF', 'CFR'");
    expect(sql).toContain("'LCO', 'FOB'");
    expect(sql).toContain('GREATEST');
  });

  it('qty_move quantity_delivery ignores zero vessel so trucking qty is not masked', () => {
    const sql = buildQtyMoveCte({ kind: 'join_scope', scopeCteName: 'contract_scope' });
    expect(sql).toContain('NULLIF');
    expect(sql).toContain('quantity_delivery_vessel');
    expect(sql).toContain('quantity_delivery_trucking');
  });
});
