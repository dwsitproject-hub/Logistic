import { describe, expect, it } from 'vitest';
import {
  computeOpenCashCycleDays,
  computeOpenDpCycleDays,
  computeOpenLogCycleDays,
  isContractIncludedInPerfDrilldownTree,
  isContractIncludedInPerfDrilldownTreeWithComputed,
  isContractPerfOnTimeTradeCycle,
  resolveEffectiveDeliveryEnd,
  resolveOpenEffectiveCompletionEnd,
  resolveSapDpCalendarDate,
  resolveSapPayoffCalendarDate,
} from './latePerformance.service';

describe('resolveEffectiveDeliveryEnd', () => {
  it('uses contracts.delivery_end_date when present', () => {
    const d = resolveEffectiveDeliveryEnd({ delivery_end_date: '2026-06-15' });
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(15);
  });

  it('falls back to SAP contract JSON due_date_delivery_end', () => {
    const d = resolveEffectiveDeliveryEnd({
      delivery_end_date: null,
      latest_spd_data: { contract: { due_date_delivery_end: '19-Sep-25' } },
    });
    expect(d?.getFullYear()).toBe(2025);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(19);
  });

  it('returns null when DB and SAP due end are both empty (Open contract skip case)', () => {
    expect(
      resolveEffectiveDeliveryEnd({
        delivery_end_date: null,
        latest_spd_data: { contract: { status: 'Open', due_date_delivery_end: '' } },
      }),
    ).toBeNull();
  });
});

describe('isContractPerfOnTimeTradeCycle', () => {
  it('Condition B (no standard ETA): trade cycle 0 is late, not on-time', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: null,
    };
    expect(isContractPerfOnTimeTradeCycle(row, 0)).toBe(false);
    expect(isContractPerfOnTimeTradeCycle(row, -1)).toBe(true);
  });

  it('Condition A (standard ETA present): trade cycle 0 is on-time', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: '2026-07-01',
    };
    expect(isContractPerfOnTimeTradeCycle(row, 0)).toBe(true);
  });
});

describe('Open cycle Today fallback (Condition B)', () => {
  const todayMid = new Date(2026, 5, 10);

  it('resolveOpenCycleCompletionEnd uses today when standard ETA is empty', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: null,
      last_eta_vessel_complete_discharge: null,
    };
    const end = resolveOpenEffectiveCompletionEnd(row, 'SEA', todayMid);
    expect(end).toBeInstanceOf(Date);
    expect((end as Date).getFullYear()).toBe(2026);
    expect((end as Date).getMonth()).toBe(5);
    expect((end as Date).getDate()).toBe(10);
  });

  it('computeOpenCashCycleDays returns days when Open and ETA discharge is missing', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: null,
      last_eta_vessel_complete_discharge: null,
    };
    const rowWithPayoff = {
      ...row,
      latest_spd_data: { payment: { payoff_date: '2026-06-01' } },
    };
    const days = computeOpenCashCycleDays(rowWithPayoff, 'SEA', todayMid);
    expect(days).toBe(9);
  });

  it('computeOpenDpCycleDays returns days when Open and trucking deliverable is missing', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'LAND',
      open_standard_eta_trucking: null,
      last_trucking_daily_deliverable_date: null,
      latest_spd_data: { payment: { dp_date: '2026-06-05' } },
    };
    const days = computeOpenDpCycleDays(row, 'LAND', todayMid);
    expect(days).toBe(5);
  });

  it('computeOpenLogCycleDays returns days when Open and ETA is empty', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: null,
      last_eta_vessel_complete_discharge: null,
    };
    const days = computeOpenLogCycleDays(row, 'SEA', todayMid, '2026-05-20');
    expect(days).toBe(21);
  });

  it('uses completion ETA when standard ETA is present (Condition A)', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: '2026-07-01',
      last_eta_vessel_complete_discharge: '2026-06-20',
      latest_spd_data: { payment: { payoff_date: '2026-06-01' } },
    };
    const days = computeOpenCashCycleDays(row, 'SEA', todayMid);
    expect(days).toBe(19);
  });

  it('returns null Cash Cycle when SAP Payoff Date is missing even if ETA uses Today', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: null,
      last_eta_vessel_complete_discharge: null,
      latest_spd_data: { payment: {} },
    };
    expect(resolveSapPayoffCalendarDate(row)).toBeNull();
    expect(computeOpenCashCycleDays(row, 'SEA', todayMid)).toBeNull();
  });

  it('returns null Cash Cycle when standard ETA exists but discharge date is missing', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: '2026-07-01',
      last_eta_vessel_complete_discharge: null,
      latest_spd_data: { payment: { payoff_date: '2026-06-01' } },
    };
    expect(resolveOpenEffectiveCompletionEnd(row, 'SEA', todayMid)).toBeNull();
    expect(computeOpenCashCycleDays(row, 'SEA', todayMid)).toBeNull();
  });

  it('resolveSapDpCalendarDate returns null when DP Date raw is empty', () => {
    expect(resolveSapDpCalendarDate({ latest_spd_data: { raw: {} } })).toBeNull();
  });
});

describe('isContractIncludedInPerfDrilldownTreeWithComputed', () => {
  const closedRowBase = {
    import_status: 'CLOSE',
    transport_mode: 'SEA',
    delivery_end_date: '2026-06-01',
    trade_cycle_days: 3,
    contract_perf_on_time: false,
  };

  it('includes closed CPO-like row when perf helper fields are already stripped', () => {
    const row = { ...closedRowBase, product: 'CPO' };
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ALL' }),
    ).toBe(true);
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'LATE' }),
    ).toBe(true);
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ON_TIME' }),
    ).toBe(false);
  });

  it('raw helper rejects closed row after trucking/ETA fields are removed', () => {
    const row = { ...closedRowBase, product: 'CPO' };
    expect(isContractIncludedInPerfDrilldownTree(row, { lateOnTimeFilter: 'ALL' })).toBe(false);
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ALL' }),
    ).toBe(true);
  });

  it('Open row with null trade_cycle_days is on-time (mirrors tree aggregate fallback)', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'MIX',
      delivery_end_date: '2026-06-01',
      product: 'CPO',
      trade_cycle_days: null,
    };
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ON_TIME' }),
    ).toBe(true);
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'LATE' }),
    ).toBe(false);
  });

  it('Open row with import_status Open but raw GR PO Close is on-time when trade_cycle_days is -1', () => {
    const row = {
      import_status: 'OPEN',
      status: 'Close',
      transport_mode: 'SEA',
      delivery_end_date: '2026-06-01',
      product: 'CPO',
      trade_cycle_days: -1,
      contract_perf_on_time: true,
    };
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ON_TIME' }),
    ).toBe(true);
  });
});
