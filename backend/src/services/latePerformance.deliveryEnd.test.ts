import { describe, expect, it } from 'vitest'
import {
  computeClosedLogCycleDays,
  computeOpenCashCycleDays,
  computeOpenDpCycleDays,
  computeOpenLogCycleDays,
  computePerfTradeCycleDaysForRow,
  isContractIncludedInPerfDrilldownTree,
  isContractIncludedInPerfDrilldownTreeWithComputed,
  isContractPerfOnTimeTradeCycle,
  resolveCycleCompletionDate,
  resolveEffectiveDeliveryEnd,
  resolveOpenEffectiveCompletionEnd,
  resolveOpenPerfOutstandingQtyKg,
  isContractInLogisticsOpenOs,
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
    expect(isContractPerfOnTimeTradeCycle(row, 1)).toBe(true)
    // Negative = the completion date overran its anchor.
    expect(isContractPerfOnTimeTradeCycle(row, -1)).toBe(false)
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
        todayMid,
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
        todayMid,
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
        todayMid,
      )?.getDate(),
    ).toBe(15)
  })

  it('LAND OS still open: skips Last Receive/WB, uses planning, and has no ETA fallback', () => {
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
        todayMid,
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
        todayMid,
      ),
      // ETA trucking is not an estimate of completion - dropped 2026-09-17 with ETA at loading port.
    ).toBeNull()
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
        todayMid,
      )?.getDate(),
    ).toBe(8)
  })

  it('SEA: ATC → ETC, and ETA at loading port is not a completion date', () => {
    expect(
      resolveCycleCompletionDate(
        {
          last_ata_vessel_complete_discharge: '2026-06-20',
          last_eta_vessel_complete_discharge: '2026-06-15',
        },
        'SEA',
        todayMid,
      )?.getDate(),
    ).toBe(20)

    // ETC in the future is used as-is.
    expect(
      resolveCycleCompletionDate(
        {
          last_ata_vessel_complete_discharge: null,
          last_eta_vessel_complete_discharge: '2026-06-15',
        },
        'SEA',
        todayMid,
      )?.getDate(),
    ).toBe(15)

    // ETC already passed: measure against today, or a late contract would stop getting later.
    expect(
      resolveCycleCompletionDate(
        {
          last_ata_vessel_complete_discharge: null,
          last_eta_vessel_complete_discharge: '2026-06-01',
        },
        'SEA',
        todayMid,
      )?.getDate(),
    ).toBe(10)

    // ETA at the loading port is the start of the voyage, not its completion: no longer a fallback.
    expect(
      resolveCycleCompletionDate(
        {
          last_ata_vessel_complete_discharge: null,
          last_eta_vessel_complete_discharge: null,
          open_standard_eta_vessel_loading: '2026-06-10',
        },
        'SEA',
        todayMid,
      ),
    ).toBeNull()
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

  it('computeOpenCashCycleDays uses ATC then ETC; null when both missing', () => {
    const withAtc = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      last_ata_vessel_complete_discharge: '2026-06-20',
      last_eta_vessel_complete_discharge: '2026-07-01',
      latest_spd_data: { payment: { payoff_date: '2026-06-01' } },
    }
    // payoff - completion: discharge finished 19 days after payoff, so the cycle is negative.
    expect(computeOpenCashCycleDays(withAtc, 'SEA', todayMid)).toBe(-19)

    const withEtcOnly = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      last_ata_vessel_complete_discharge: null,
      last_eta_vessel_complete_discharge: '2026-06-15',
      latest_spd_data: { payment: { payoff_date: '2026-06-01' } },
    }
    expect(computeOpenCashCycleDays(withEtcOnly, 'SEA', todayMid)).toBe(-14)

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

  it('Open row with null trade_cycle_days on payload is excluded from WithComputed helper', () => {
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

  it('Open SEA row with no ETA/ATA returns null Trade Cycle (no Condition B)', () => {
    const todayMid = new Date(2026, 5, 10)
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      delivery_end_date: '2026-06-15',
      open_standard_eta_vessel_loading: null,
      last_ata_vessel_complete_discharge: null,
    }
    expect(computePerfTradeCycleDaysForRow(row, todayMid)).toBeNull()
    expect(isContractIncludedInPerfDrilldownTree(row, { lateOnTimeFilter: 'ALL' })).toBe(false)
  })

  it('Open SEA ATC null + ETC before today uses today as completion', () => {
    const todayMid = new Date(2026, 5, 10)
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      delivery_end_date: '2026-06-01',
      last_eta_vessel_complete_discharge: '2026-06-05',
      last_ata_vessel_complete_discharge: null,
    }
    // due (1) - today (10) = -9, and negative is Late.
    expect(computePerfTradeCycleDaysForRow(row, todayMid)).toBe(-9)
  })

  it('Open SEA ATC null + ETC on or after today uses ETC as completion', () => {
    const todayMid = new Date(2026, 5, 10)
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      delivery_end_date: '2026-06-01',
      last_eta_vessel_complete_discharge: '2026-06-20',
      last_ata_vessel_complete_discharge: null,
    }
    // due (1) - ETC (20) = -19
    expect(computePerfTradeCycleDaysForRow(row, todayMid)).toBe(-19)
  })

  it('Open SEA prefers ATC over ETC when both present', () => {
    const todayMid = new Date(2026, 5, 10)
    const row = {
      import_status: 'OPEN',
      transport_mode: 'SEA',
      delivery_end_date: '2026-06-01',
      last_eta_vessel_complete_discharge: '2026-06-20',
      last_ata_vessel_complete_discharge: '2026-06-08',
    }
    // due (1) - ATC (8) = -7
    expect(computePerfTradeCycleDaysForRow(row, todayMid)).toBe(-7)
  })

  it('Open LAND row with no milestones has no Trade Cycle at all', () => {
    const todayMid = new Date(2026, 5, 10)
    const row = {
      import_status: 'OPEN',
      transport_mode: 'LAND',
      delivery_end_date: '2026-06-05',
      outstanding_quantity: 5000,
      last_trucking_completion_date: null,
      last_trucking_wb_actuals_date: null,
      last_trucking_daily_deliverable_date: null,
      open_standard_eta_trucking: null,
    }
    /*
     * No WB and no daily planning means no completion date, and the rule is ATC, else ETC, else
     * "-". The old `due end - today` fallback reported a contract where nothing had been planned
     * as "28 days ahead" - on track precisely when it was not - and was removed 2026-09-17.
     */
    expect(computePerfTradeCycleDaysForRow(row, todayMid)).toBeNull()

    const lateRow = { ...row, delivery_end_date: '2020-01-01' }
    // With no cycle it is unscheduled, so it is in neither the Late nor the On Time tree.
    expect(isContractIncludedInPerfDrilldownTree(lateRow, { lateOnTimeFilter: 'LATE' })).toBe(false)
  })

  it('Close row without completion stays unscheduled (no today fallback)', () => {
    const todayMid = new Date(2026, 5, 10)
    const row = {
      import_status: 'CLOSE',
      transport_mode: 'SEA',
      delivery_end_date: '2026-06-01',
      open_standard_eta_vessel_loading: null,
      last_ata_vessel_complete_discharge: null,
    }
    expect(computePerfTradeCycleDaysForRow(row, todayMid)).toBeNull()
    expect(isContractIncludedInPerfDrilldownTree(row, { lateOnTimeFilter: 'ALL' })).toBe(false)
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

describe('resolveOpenPerfOutstandingQtyKg', () => {
  it('prefers qty_move outstanding_quantity and keeps signed over-delivery', () => {
    expect(
      resolveOpenPerfOutstandingQtyKg({
        outstanding_quantity: -12000,
        quantity_ordered: 100000,
        incoterm: 'FRC',
        quantity_receive: 0,
      }),
    ).toBe(-12000)
    expect(
      resolveOpenPerfOutstandingQtyKg({
        outstanding_quantity: 45000,
        quantity_ordered: 100000,
        incoterm: 'LCO',
        quantity_delivery_sap: 0,
      }),
    ).toBe(45000)
  })

  it('falls back to contract qty minus incoterm fulfilled when outstanding_quantity is missing', () => {
    expect(
      resolveOpenPerfOutstandingQtyKg({
        quantity_ordered: 100000,
        incoterm: 'FRC',
        quantity_receive: 25000,
      }),
    ).toBe(75000)
    expect(
      resolveOpenPerfOutstandingQtyKg({
        quantity_ordered: 100000,
        incoterm: 'FOB',
        quantity_delivery: 110000,
      }),
    ).toBe(-10000)
    expect(
      resolveOpenPerfOutstandingQtyKg({
        quantity_ordered: 1500000,
        incoterm: 'LCO',
        quantity_delivery: 1168720,
        quantity_delivery_sap: 89990,
      }),
    ).toBe(331280)
  })
})

describe('isContractInLogisticsOpenOs', () => {
  it('treats pg boolean true as in-strip', () => {
    expect(isContractInLogisticsOpenOs({ in_logistics_open_os: true })).toBe(true)
    expect(isContractInLogisticsOpenOs({ in_logistics_open_os: 't' })).toBe(true)
    expect(isContractInLogisticsOpenOs({ in_logistics_open_os: false })).toBe(false)
    expect(isContractInLogisticsOpenOs({})).toBe(false)
  })
})
