import { describe, expect, it } from 'vitest'

import {

  SHIPMENT_COLUMN_LAYOUT_VERSION,

  SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS,

  SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID,

  SHIPMENT_MANUAL_SELECT_COLUMN_ID,

  SHIPMENT_STAGE_GATED_COLUMN_IDS,

  SHIPMENT_TRADE_CYCLE_COLUMN_ID,

  SHIPMENT_UNPLANNED_ONLY_COLUMN_IDS,

  buildShipmentVisibleColumns,

  filterShipmentVisibleColumnIdsForStage,

  isShipmentGroupingSuggestionColumnEligible,

  isShipmentTradeCycleColumnEligible,

  isShipmentUnplannedOnlyColumnEligible,

  mergeShipmentColumnOrder,

  migrateShipmentColumnLayout,

  shipmentCompactColumnFallbackOrder,

  shipmentDefaultVisibleColumnIdsForStage,

} from './shipmentColumns'



describe('shipmentColumns', () => {

  it('uses v11 default visible order (status then grouping; Trade Cycle; no OS Plan)', () => {

    expect(SHIPMENT_COLUMN_LAYOUT_VERSION).toBe('shipments-columns-v11')

    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS.slice(0, 5)).toEqual([

      'status',

      'pre_planned_group',

      'late_indicator',

      'vessel_name',

      'shipment_id',

    ])

    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS).toContain('contract_qty')

    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS).toContain(SHIPMENT_TRADE_CYCLE_COLUMN_ID)

    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS).not.toContain('outstanding_qty_planning')

    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS).not.toContain('contract_date')

    expect(SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS).not.toContain('sto_quantity')

  })



  it('shows Grouping Suggestion and Grouping Manual on Unplanned and Preplanned only', () => {

    const allIds = [...SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS, 'contract_date', SHIPMENT_MANUAL_SELECT_COLUMN_ID]

    expect(isShipmentGroupingSuggestionColumnEligible('UNPLANNED')).toBe(true)

    expect(isShipmentGroupingSuggestionColumnEligible('PREPLANNED')).toBe(true)

    expect(isShipmentGroupingSuggestionColumnEligible('ALL')).toBe(false)

    expect(isShipmentGroupingSuggestionColumnEligible('PLANNED')).toBe(false)



    expect(shipmentDefaultVisibleColumnIdsForStage(allIds, 'UNPLANNED')).toContain(

      SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID,

    )

    expect(shipmentDefaultVisibleColumnIdsForStage(allIds, 'PREPLANNED')).toContain(

      SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID,

    )

    expect(shipmentDefaultVisibleColumnIdsForStage(allIds, 'ALL')).not.toContain(

      SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID,

    )



    const visible = new Set([

      SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID,

      SHIPMENT_MANUAL_SELECT_COLUMN_ID,

      'status',

    ])

    const plannedFiltered = filterShipmentVisibleColumnIdsForStage(visible, 'PLANNED')

    expect(plannedFiltered.has(SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID)).toBe(false)

    expect(plannedFiltered.has(SHIPMENT_MANUAL_SELECT_COLUMN_ID)).toBe(false)

    const unplannedFiltered = filterShipmentVisibleColumnIdsForStage(visible, 'UNPLANNED')

    expect(unplannedFiltered.has(SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID)).toBe(true)

    expect(unplannedFiltered.has(SHIPMENT_MANUAL_SELECT_COLUMN_ID)).toBe(true)

    const preplannedFiltered = filterShipmentVisibleColumnIdsForStage(visible, 'PREPLANNED')

    expect(preplannedFiltered.has(SHIPMENT_GROUPING_SUGGESTION_COLUMN_ID)).toBe(true)

    expect(preplannedFiltered.has(SHIPMENT_MANUAL_SELECT_COLUMN_ID)).toBe(true)

  })



  it('shows Trade Cycle when Unplanned card or Pending ATC filter is selected', () => {

    const allIds = [...SHIPMENT_DEFAULT_VISIBLE_COLUMN_IDS]

    expect(isShipmentUnplannedOnlyColumnEligible('UNPLANNED')).toBe(true)

    expect(isShipmentUnplannedOnlyColumnEligible('PREPLANNED')).toBe(false)

    expect(isShipmentUnplannedOnlyColumnEligible('ALL')).toBe(false)

    expect(isShipmentTradeCycleColumnEligible('ALL', { pendingAtcDueWithin7d: true })).toBe(true)

    expect(SHIPMENT_UNPLANNED_ONLY_COLUMN_IDS).toContain(SHIPMENT_TRADE_CYCLE_COLUMN_ID)



    expect(shipmentDefaultVisibleColumnIdsForStage(allIds, 'UNPLANNED')).toContain(

      SHIPMENT_TRADE_CYCLE_COLUMN_ID,

    )

    expect(
      shipmentDefaultVisibleColumnIdsForStage(allIds, 'ALL', { pendingAtcDueWithin7d: true }),
    ).toContain(SHIPMENT_TRADE_CYCLE_COLUMN_ID)

    expect(shipmentDefaultVisibleColumnIdsForStage(allIds, 'PREPLANNED')).not.toContain(

      SHIPMENT_TRADE_CYCLE_COLUMN_ID,

    )

    expect(shipmentDefaultVisibleColumnIdsForStage(allIds, 'ALL')).not.toContain(

      SHIPMENT_TRADE_CYCLE_COLUMN_ID,

    )



    const visible = new Set([SHIPMENT_TRADE_CYCLE_COLUMN_ID, 'status', ...SHIPMENT_STAGE_GATED_COLUMN_IDS])

    expect(filterShipmentVisibleColumnIdsForStage(visible, 'UNPLANNED').has(SHIPMENT_TRADE_CYCLE_COLUMN_ID)).toBe(

      true,

    )

    expect(
      filterShipmentVisibleColumnIdsForStage(visible, 'ALL', { pendingAtcDueWithin7d: true }).has(
        SHIPMENT_TRADE_CYCLE_COLUMN_ID,
      ),
    ).toBe(true)

    expect(filterShipmentVisibleColumnIdsForStage(visible, 'PREPLANNED').has(SHIPMENT_TRADE_CYCLE_COLUMN_ID)).toBe(

      false,

    )

    expect(filterShipmentVisibleColumnIdsForStage(visible, 'PLANNED').has(SHIPMENT_TRADE_CYCLE_COLUMN_ID)).toBe(

      false,

    )

  })



  it('migrateShipmentColumnLayout drops Outstanding Qty (Plan)', () => {

    const result = migrateShipmentColumnLayout(

      ['vessel_name', 'outstanding_qty_planning', 'outstanding_quantity'],

      ['vessel_name', 'outstanding_qty_planning', 'outstanding_quantity'],

    )

    expect(result.visibleColumnIds).not.toContain('outstanding_qty_planning')

    expect(result.columnOrderIds).not.toContain('outstanding_qty_planning')

    expect(result.visibleColumnIds).toContain('loading_port')

  })



  it('places primary columns first then extras', () => {

    const allIds = ['contract_date', 'vessel_name', 'loading_port', 'po_numbers', 'late_indicator', 'status']

    expect(shipmentCompactColumnFallbackOrder(allIds)).toEqual([

      'status',

      'late_indicator',

      'vessel_name',

      'loading_port',

      'contract_date',

      'po_numbers',

    ])

  })



  it('builds visible columns from saved order', () => {

    const cols = [

      { id: 'vessel_name', label: 'Vessel' },

      { id: 'loading_port', label: 'Loading Port' },

      { id: 'contract_date', label: 'Contract Date' },

    ]

    const visible = buildShipmentVisibleColumns(cols, new Set(['vessel_name', 'contract_date']), [

      'contract_date',

      'vessel_name',

    ])

    expect(visible.map((c) => c.id)).toEqual(['contract_date', 'vessel_name'])

  })



  it('mergeShipmentColumnOrder preserves user order including non-primary columns', () => {

    const allIds = ['late_indicator', 'vessel_name', 'quantity_delivered', 'quantity_receive', 'contract_date']

    expect(

      mergeShipmentColumnOrder(

        ['quantity_delivered', 'vessel_name', 'quantity_receive', 'late_indicator'],

        allIds,

      ),

    ).toEqual([

      'quantity_delivered',

      'vessel_name',

      'quantity_receive',

      'late_indicator',

      'contract_date',

    ])

  })



  it('migrateShipmentColumnLayout drops raw port columns and ensures SAP port columns', () => {

    const result = migrateShipmentColumnLayout(

      ['vessel_name', 'port_of_loading'],

      ['vessel_name', 'port_of_loading', 'port_of_discharge'],

    )

    expect(result.visibleColumnIds).toContain('loading_port')

    expect(result.visibleColumnIds).toContain('discharge_port')

    expect(result.visibleColumnIds).not.toContain('port_of_loading')

    expect(result.columnOrderIds).not.toContain('port_of_loading')

    expect(result.columnOrderIds).not.toContain('port_of_discharge')

  })

})


