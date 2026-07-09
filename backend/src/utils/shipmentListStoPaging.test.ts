import { describe, expect, it } from 'vitest';
import {
  SHIPMENT_BASE_CORE_GROUP_BY_MARKER,
  buildRankedStoCtes,
  canUseShipmentStoKeyPaging,
  injectShipmentStoKeyPaging,
} from './shipmentListStoPaging';

describe('shipmentListStoPaging', () => {
  it('canUseShipmentStoKeyPaging allows toolbar-only scope', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '',
        colFilters: {},
      }),
    ).toBe(true);
  });

  it('canUseShipmentStoKeyPaging blocks status card filters', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'PLANNED',
      }),
    ).toBe(false);
  });

  it('injectShipmentStoKeyPaging inserts ranked_sto and paged filter', () => {
    const stoKey = `COALESCE(
      CASE WHEN NULLIF(TRIM(s.shipment_id::text), '') ~ '^[0-9]+$' THEN NULLIF(TRIM(s.shipment_id::text), '') ELSE NULL END,
      NULLIF(TRIM(c.sto_number::text), '')
    )`;
    const base = `WITH latest_spd_contract AS (SELECT 1),
      shipment_base_core AS (
        SELECT 1 AS sto_key
        WHERE 1=1
        ${SHIPMENT_BASE_CORE_GROUP_BY_MARKER} GROUP BY 1
      )`;
    const ranked = buildRankedStoCtes(stoKey, '1=1', '1=1').replace(
      '__STO_PAGE_LIMIT__',
      '20',
    ).replace('__STO_PAGE_OFFSET__', '0');
    const injected = injectShipmentStoKeyPaging(base, stoKey, ranked);
    expect(injected).toContain('ranked_sto AS');
    expect(injected).toContain('paged_sto AS');
    expect(injected).toContain('sto_link_agg AS');
    expect(injected).toContain('FROM paged_sto');
    expect(injected).toContain("'^[0-9]+$'");
    expect(injected).not.toContain("'^[0-9]+ GROUP BY");
  });
});
