import {
  appendShipmentEtcNoAtcDueWithin7dFilter,
  buildShipmentEtcNoAtcDueWithin7dQuery,
  ETC_NO_ATC_DUE_HORIZON_DAYS,
  EMPTY_SHIPMENT_ETC_NO_ATC_DUE_WITHIN_7D,
  isShipmentEtcNoAtcDueWithin7dListFilter,
  parseShipmentEtcNoAtcDueWithin7dRow,
  sqlShipmentEtcNoAtcDueWithin7dPred,
  sqlShipmentListAtcDateExpr,
} from './shipmentEtcNoAtcDueSql';

describe('shipmentEtcNoAtcDueSql', () => {
  it('uses a 7-day inclusive due-end horizon', () => {
    expect(ETC_NO_ATC_DUE_HORIZON_DAYS).toBe(7);
  });

  it('builds ATC date expression from shipment_base columns', () => {
    expect(sqlShipmentListAtcDateExpr('fs')).toBe('fs.ata_vessel_complete_discharge::date');
  });

  it('requires ATC null and due end on or before today+7; no ETC check', () => {
    const pred = sqlShipmentEtcNoAtcDueWithin7dPred('fs');
    expect(pred).toContain('ata_vessel_complete_discharge::date IS NULL');
    expect(pred).toContain('delivery_end_date IS NOT NULL');
    expect(pred).toContain(
      `delivery_end_date::date <= (CURRENT_DATE + ${ETC_NO_ATC_DUE_HORIZON_DAYS})`,
    );
    expect(pred).not.toContain('BETWEEN CURRENT_DATE');
    expect(pred).toContain("NOT IN ('COMPLETED', 'CANCELLED')");
    expect(pred).toContain('is_contract_sap_closed');
  });

  it('appendShipmentEtcNoAtcDueWithin7dFilter toggles list outer SQL', () => {
    expect(appendShipmentEtcNoAtcDueWithin7dFilter(false).sql).toBe('');
    expect(appendShipmentEtcNoAtcDueWithin7dFilter(undefined).sql).toBe('');
    const on = appendShipmentEtcNoAtcDueWithin7dFilter('true');
    expect(on.sql).toContain(' AND ');
    expect(on.sql).toContain('sb.ata_vessel_complete_discharge');
    expect(on.sql).toContain('sb.delivery_end_date');
    expect(on.sql).toContain(
      `sb.delivery_end_date::date <= (CURRENT_DATE + ${ETC_NO_ATC_DUE_HORIZON_DAYS})`,
    );
    expect(on.sql).toContain("NOT IN ('COMPLETED', 'CANCELLED')");
  });

  it('isShipmentEtcNoAtcDueWithin7dListFilter parses query flag', () => {
    expect(isShipmentEtcNoAtcDueWithin7dListFilter(true)).toBe(true);
    expect(isShipmentEtcNoAtcDueWithin7dListFilter('true')).toBe(true);
    expect(isShipmentEtcNoAtcDueWithin7dListFilter(false)).toBe(false);
    expect(isShipmentEtcNoAtcDueWithin7dListFilter(undefined)).toBe(false);
  });

  it('builds aggregate query with matching_page + execution_os', () => {
    const sql = buildShipmentEtcNoAtcDueWithin7dQuery(
      'WITH shipment_base AS (SELECT 1)',
      " AND sb.product ILIKE '%RBD%'",
    );
    expect(sql).toContain('matching_page');
    expect(sql).toContain('execution_os');
    expect(sql).toContain('etc_no_atc_due_within_7d_count');
    expect(sql).toContain('etc_no_atc_due_within_7d_outstanding_qty');
    expect(sql).toContain("sb.product ILIKE '%RBD%'");
  });

  it('parses aggregate row and empty fallback', () => {
    expect(parseShipmentEtcNoAtcDueWithin7dRow(null)).toEqual(
      EMPTY_SHIPMENT_ETC_NO_ATC_DUE_WITHIN_7D,
    );
    expect(
      parseShipmentEtcNoAtcDueWithin7dRow({
        etc_no_atc_due_within_7d_count: '3',
        etc_no_atc_due_within_7d_outstanding_qty: '12500.5',
      }),
    ).toEqual({ count: 3, outstandingQtyKg: 12500.5 });
  });
});
