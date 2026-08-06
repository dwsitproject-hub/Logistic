import { describe, expect, it } from 'vitest';
import {
  SHIPMENT_BASE_CORE_GROUP_BY_MARKER,
  buildRankedStoCtes,
  buildResolvedStoKeyPageCtes,
  canUseShipmentStageSnapshotPaging,
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

  it('canUseShipmentStoKeyPaging blocks ALL hybrid list path', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '',
        colFilters: {},
        allHybrid: true,
      }),
    ).toBe(false);
  });

  it('canUseShipmentStoKeyPaging blocks exact PO search when ALL hybrid is active', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '1001031130',
        colFilters: {},
        allHybrid: true,
      }),
    ).toBe(false);
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

  it('canUseShipmentStoKeyPaging allows exact numeric STO global search', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '1016010973',
        colFilters: {},
      }),
    ).toBe(true);
  });

  it('canUseShipmentStoKeyPaging allows exact 10-digit PO global search', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '1011003113',
        colFilters: {},
      }),
    ).toBe(true);
  });

  it('canUseShipmentStoKeyPaging allows product multi column filter (pre-group safe)', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '',
        colFilters: { product: { type: 'multi', values: ['CPO'] } },
      }),
    ).toBe(true);
  });

  it('canUseShipmentStoKeyPaging allows product + incoterm + supplier multi filters together', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '',
        colFilters: {
          product: { type: 'multi', values: ['CPO'] },
          incoterm: { type: 'multi', values: ['FOB'] },
          supplier: { type: 'multi', values: ['SOME SUPPLIER'] },
        },
      }),
    ).toBe(true);
  });

  it('canUseShipmentStoKeyPaging blocks product filter when type is not multi', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '',
        colFilters: { product: { type: 'text', value: 'CPO' } },
      }),
    ).toBe(false);
  });

  it('canUseShipmentStoKeyPaging blocks non-whitelisted column filters', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '',
        colFilters: { vessel_name: { type: 'text', value: 'MV Pacific' } },
      }),
    ).toBe(false);
  });

  it('canUseShipmentStoKeyPaging blocks mix of safe and unsafe column filters', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '',
        colFilters: {
          product: { type: 'multi', values: ['CPO'] },
          port_of_loading: { type: 'text', value: 'Marunda' },
        },
      }),
    ).toBe(false);
  });

  it('canUseShipmentStoKeyPaging blocks fuzzy global search', () => {
    expect(
      canUseShipmentStoKeyPaging({
        summaryOnly: false,
        stoIsSet: false,
        status: 'ALL',
        globalSearch: '101601',
        colFilters: {},
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
    const ranked = buildRankedStoCtes(stoKey, '1=1').replace(
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

  it('canUseShipmentStageSnapshotPaging requires a grouped status card', () => {
    const base = {
      summaryOnly: false,
      stoIsSet: false,
      globalSearch: '',
      colFilters: {},
    };
    expect(canUseShipmentStageSnapshotPaging({ ...base, status: 'PLANNED' })).toBe(true);
    expect(canUseShipmentStageSnapshotPaging({ ...base, status: 'COMPLETED' })).toBe(true);
    expect(canUseShipmentStageSnapshotPaging({ ...base, status: 'ALL' })).toBe(false);
    expect(canUseShipmentStageSnapshotPaging({ ...base, status: 'UNPLANNED' })).toBe(false);
    // Non-toolbar filters force the live path.
    expect(
      canUseShipmentStageSnapshotPaging({ ...base, status: 'PLANNED', globalSearch: 'vessel x' }),
    ).toBe(false);
    expect(
      canUseShipmentStageSnapshotPaging({ ...base, status: 'PLANNED', lateIndicator: 'LATE' }),
    ).toBe(false);
  });

  it('buildResolvedStoKeyPageCtes preserves key order and escapes quotes', () => {
    const sql = buildResolvedStoKeyPageCtes(['1006018771', "OP'X", '1006018772']);
    expect(sql).toContain('ranked_sto AS');
    expect(sql).toContain('paged_sto AS');
    expect(sql).toContain('sto_link_agg AS');
    expect(sql).toContain("('1006018771', 0)");
    expect(sql).toContain("('OP''X', 1)");
    expect(sql).toContain("('1006018772', 2)");
    expect(sql).toContain('ORDER BY ord');
  });

  it('buildResolvedStoKeyPageCtes yields an empty page for no keys', () => {
    const sql = buildResolvedStoKeyPageCtes([]);
    expect(sql).toContain('WHERE FALSE');
    expect(sql).toContain('paged_sto AS');
  });
});
