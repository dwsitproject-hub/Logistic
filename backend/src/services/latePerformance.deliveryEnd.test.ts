import { describe, expect, it } from 'vitest'
import {
  computeClosedLogCycleDays,
  computeOpenCashCycleDays,
  computeOpenDpCycleDays,
  computeOpenLogCycleDays,
  isContractIncludedInPerfDrilldownTree,
  isContractIncludedInPerfDrilldownTreeWithComputed,
  isContractPerfOnTimeTradeCycle,
  resolveCycleCompletionDate,
  resolveEffectiveDeliveryEnd,
  resolveOpenEffectiveCompletionEnd,
  resolveSapDpCalendarDate,
  resolveSapPayoffCalendarDate,
} from './latePerformance.service'

describe('resolveEffectiveDeliveryEnd', () => {
  it('uses contracts.delivery_end_date when present', () => {
    const d = resolveEffectiveDeliveryEnd({ delivery_end_date: '2026-06-15' })
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(5)
    expect(d?.getDate()).toBe(15)
  })

  it('falls back to SAP contract JSON due_date_delivery_end', () => {
    const d = resolveEffectiveDeliveryEnd({
      delivery_end_date: null,
      latest_spd_data: { contract: { due_date_delivery_end: '19-Sep-25' } },
    })
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getMonth()).toBe(8)
    expect(d?.getDate()).toBe(19)
  })

  it('returns null when DB and SAP due end are both empty (Open contract skip case)', () => {
    expect(
      resolveEffectiveDeliveryEnd({
        delivery_end_date: null,
        latest_spd_data: { contract: { status: 'Open', due_date_delivery_end: '' } },
      }),
    ).toBeNull()
  })
})

describe('isContractPerfOnTimeTradeCycle', () => {
  it('Condition B (no standard ETA): trade cycle 0 is on-time (due today)', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: null,
    }
    expect(isContractPerfOnTimeTradeCycle(row, 0)).toBe(true)
    expect(isContractPerfOnTimeTradeCycle(row, -1)).toBe(true)
    expect(isContractPerfOnTimeTradeCycle(row, 1)).toBe(false)
  })

  it('Condition A (standard ETA present): trade cycle 0 is on-time', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      open_standard_eta_vessel_loading: '2026-07-01',
    }
    expect(isContractPerfOnTimeTradeCycle(row, 0)).toBe(true)
  })
})

describe('resolveCycleCompletionDate (no Today)', () => {
  const todayMid = new Date(2026, 5, 10)

  it('LAND OS≈0: Last Receive → WB → planning ETA', () => {
    expect(
      resolveCycleCompletionDate(
        {
          outstanding_quantity: 0,
          last_trucking_completion_date: '2026-06-01',
          last_trucking_wb_actuals_date: '2026-06-08',
          last_trucking_daily_deliverable_date: '2026-06-15',
        },
        'LAND',
      )?.getDate(),
    ).toBe(1)

    expect(
      resolveCycleCompletionDate(
        {
          outstanding_quantity: 0,
          last_trucking_completion_date: null,
          last_trucking_wb_actuals_date: '2026-06-08',
          last_trucking_daily_deliverable_date: '2026-06-15',
        },
        'LAND',
      )?.getDate(),
    ).toBe(8)

    expect(
      resolveCycleCompletionDate(
        {
          outstanding_quantity: 0,
          last_trucking_completion_date: null,
          last_trucking_wb_actuals_date: null,
          last_trucking_daily_deliverable_date: '2026-06-15',
        },
        'LAND',
      )?.getDate(),
    ).toBe(15)
  })

  it('LAND OS still open: skips Last Receive/WB and uses planning then ETA', () => {
    expect(
      resolveCycleCompletionDate(
        {
          outstanding_quantity: 5000,
          last_trucking_completion_date: '2026-06-01',
          last_trucking_wb_actuals_date: '2026-06-08',
          last_trucking_daily_deliverable_date: '2026-06-15',
          open_standard_eta_trucking: '2026-06-20',
        },
        'LAND',
      )?.getDate(),
    ).toBe(15)

    expect(
      resolveCycleCompletionDate(
        {
          outstanding_quantity: 5000,
          last_trucking_completion_date: '2026-06-01',
          last_trucking_wb_actuals_date: '2026-06-08',
          last_trucking_daily_deliverable_date: null,
          open_standard_eta_trucking: '2026-06-20',
        },
        'LAND',
      )?.getDate(),
    ).toBe(20)
  })

  it('LAND OS within 0 MT band (≤499 kg) still allows WB Last Receive', () => {
    expect(
      resolveCycleCompletionDate(
        {
          outstanding_quantity: 286,
          last_trucking_wb_actuals_date: '2026-06-08',
          last_trucking_daily_deliverable_date: '2026-06-15',
        },
        'LAND',
      )?.getDate(),
    ).toBe(8)
  })

  it('SEA: ATC → ETA at LP', () => {
    expect(
      resolveCycleCompletionDate(
        {
          last_ata_vessel_complete_discharge: '2026-06-20',
          open_standard_eta_vessel_loading: '2026-06-10',
        },
        'SEA',
      )?.getDate(),
    ).toBe(20)

    expect(
      resolveCycleCompletionDate(
        {
          last_ata_vessel_complete_discharge: null,
          open_standard_eta_vessel_loading: '2026-06-10',
        },
        'SEA',
      )?.getDate(),
    ).toBe(10)
  })

  it('returns null when all completion sources are empty (no Today)', () => {
    expect(
      resolveCycleCompletionDate(
        {
          last_trucking_completion_date: null,
          last_trucking_wb_actuals_date: null,
          last_trucking_daily_deliverable_date: null,
        },
        'LAND',
      ),
    ).toBeNull()
    expect(
      resolveOpenEffectiveCompletionEnd(
        {
          open_standard_eta_vessel_loading: null,
          last_ata_vessel_complete_discharge: null,
        },
        'SEA',
        todayMid,
      ),
    ).toBeNull()
  })

  it('computeOpenCashCycleDays uses ATC then ETA at LP; null when both missing', () => {
    const withAtc = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      last_ata_vessel_complete_discharge: '2026-06-20',
      open_standard_eta_vessel_loading: '2026-07-01',
      latest_spd_data: { payment: { payoff_date: '2026-06-01' } },
    }
    expect(computeOpenCashCycleDays(withAtc, 'SEA', todayMid)).toBe(19)

    const withEtaOnly = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      last_ata_vessel_complete_discharge: null,
      open_standard_eta_vessel_loading: '2026-06-10',
      latest_spd_data: { payment: { payoff_date: '2026-06-01' } },
    }
    expect(computeOpenCashCycleDays(withEtaOnly, 'SEA', todayMid)).toBe(9)

    const missing = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      last_ata_vessel_complete_discharge: null,
      open_standard_eta_vessel_loading: null,
      latest_spd_data: { payment: { payoff_date: '2026-06-01' } },
    }
    expect(computeOpenCashCycleDays(missing, 'SEA', todayMid)).toBeNull()
  })

  it('LAND prefers Last Receive over WB and planning for Log/DP when OS≈0', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'LAND',
      outstanding_quantity: 0,
      last_trucking_completion_date: '2026-06-08',
      last_trucking_wb_actuals_date: '2026-06-09',
      last_trucking_daily_deliverable_date: '2026-06-15',
    }
    const end = resolveCycleCompletionDate(row, 'LAND')
    expect(end).toBeInstanceOf(Date)
    expect(end!.getFullYear()).toBe(2026)
    expect(end!.getMonth()).toBe(5)
    expect(end!.getDate()).toBe(8)

    expect(computeOpenLogCycleDays(row, 'LAND', todayMid, '2026-06-01')).toBe(-7)

    const wbOnlyEnd = resolveCycleCompletionDate(
      { ...row, last_trucking_completion_date: null },
      'LAND',
    )
    expect(wbOnlyEnd!.getDate()).toBe(9)

    expect(
      computeOpenDpCycleDays(
        { ...row, latest_spd_data: { payment: { dp_date: '2026-06-05' } } },
        'LAND',
        todayMid,
      ),
    ).not.toBeNull()
  })

  it('Log Cycle = Cargo Readiness − Completion (ready 1 Jun, completion 10 Jun → −9)', () => {
    const landRow = {
      import_status: 'CLOSE',
      transport_mode: 'LAND',
      outstanding_quantity: 0,
      last_trucking_completion_date: '2026-06-10',
    }
    expect(computeClosedLogCycleDays(landRow, 'LAND', '2026-06-01')).toBe(-9)
    expect(computeOpenLogCycleDays(landRow, 'LAND', todayMid, '2026-06-01')).toBe(-9)

    const seaRow = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      last_ata_vessel_complete_discharge: '2026-06-10',
    }
    expect(computeClosedLogCycleDays(seaRow, 'SEA', '2026-06-01')).toBe(-9)
    expect(computeOpenLogCycleDays(seaRow, 'SEA', todayMid, '2026-06-01')).toBe(-9)
  })

  it('returns null Cash Cycle when SAP Payoff Date is missing', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      last_ata_vessel_complete_discharge: '2026-06-20',
      open_standard_eta_vessel_loading: null,
      latest_spd_data: { payment: {} },
    }
    expect(resolveSapPayoffCalendarDate(row)).toBeNull()
    expect(computeOpenCashCycleDays(row, 'SEA', todayMid)).toBeNull()
  })

  it('resolveSapDpCalendarDate returns null when DP Date raw is empty', () => {
    expect(resolveSapDpCalendarDate({ latest_spd_data: { raw: {} } })).toBeNull()
  })
})

describe('isContractIncludedInPerfDrilldownTreeWithComputed', () => {
  const closedRowBase = {
    import_status: 'CLOSE',
    transport_mode: 'SEA',
    delivery_end_date: '2026-06-01',
    trade_cycle_days: 3,
    contract_perf_on_time: false,
  }

  it('includes closed CPO-like row when perf helper fields are already stripped', () => {
    const row = { ...closedRowBase, product: 'CPO' }
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ALL' }),
    ).toBe(true)
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'LATE' }),
    ).toBe(true)
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ON_TIME' }),
    ).toBe(false)
  })

  it('raw helper rejects closed row after trucking/ETA fields are removed', () => {
    const row = { ...closedRowBase, product: 'CPO' }
    expect(isContractIncludedInPerfDrilldownTree(row, { lateOnTimeFilter: 'ALL' })).toBe(false)
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ALL' }),
    ).toBe(true)
  })

  it('Open row with null trade_cycle_days is unscheduled (excluded from late/on-time)', () => {
    const row = {
      import_status: 'OPEN',
      transport_mode: 'MIX',
      delivery_end_date: '2026-06-01',
      product: 'CPO',
      trade_cycle_days: null,
    }
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ALL' }),
    ).toBe(false)
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ON_TIME' }),
    ).toBe(false)
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'LATE' }),
    ).toBe(false)
  })

  it('Open row with import_status Open but raw GR PO Close is on-time when trade_cycle_days is -1', () => {
    const row = {
      import_status: 'OPEN',
      status: 'Close',
      transport_mode: 'SEA',
      delivery_end_date: '2026-06-01',
      product: 'CPO',
      trade_cycle_days: -1,
      contract_perf_on_time: true,
    }
    expect(
      isContractIncludedInPerfDrilldownTreeWithComputed(row, { lateOnTimeFilter: 'ON_TIME' }),
    ).toBe(true)
  })
})
