/** Hover help for calculated / business-logic fields (Contracts, Dashboard, etc.) */

export const FIELD_HELP = {
  overUnderDelivery: `When contract status is Close: compares Outstanding Quantity vs 0 — "Over Delivery" when outstanding < 0, "Under Delivery" when outstanding > 0, or "Passed" when outstanding = 0. Open contracts show "-".`,

  logCycle: `Cargo Readiness Date − Completion Date. LAND Completion: when OS ≈ 0 MT use Last Receive/WB, else Last Planning Delivery Date / ETA.`,

  tradeCycle: `Completion Date vs Due Date Delivery End. SEA: ATA Discharge Complete; if ATA is empty use ETA at LP, or today when that ETA is before today; no ETA → "-". LAND: OS ≈ 0 MT → Last Receive/WB; otherwise planning/ETA.`,

  statusCardAvgDp: `Average DP Cycle (days) for Open or Close contracts in scope. Only contracts with a valid SAP DP Date and computable cycle are included; if none qualify, the card shows "- days" (not 0 days).`,

  statusCardAvgLog: `Average Log Cycle (days) for Open or Close contracts in scope. Only contracts with cargo readiness and a valid completion end are included; if none qualify, the card shows "- days" (not 0 days).`,

  cashCycle: `Completion Date vs Payoff Date. LAND Completion: OS ≈ 0 MT → Last Receive/WB; otherwise planning/ETA.`,

  dpCycle: `Completion Date vs DP Date. LAND Completion: OS ≈ 0 MT → Last Receive/WB; otherwise planning/ETA.`,

  /** Contract Performance — Open card, Section 2 drilldown, and View table share signed qty_move OS for all SAP Open contracts. Over-delivery: +MT (green). Remaining outstanding: MT (black). */
  contractPerfOutstandingQty: `Open card + Section 2 drilldown + View table use the same signed Outstanding Qty as Contracts list (qty_move / incoterm Delivery vs Receive). All SAP Open contracts in scope are included — not limited to Shipments/Trucking active strips. Over-delivery shows as +MT (green) and reduces Open card totals. B2B origin (empty Contract Reff PO): when parent Delivery/Receive is NULL or 0, qty_move uses SUM of children capped at origin Contract Qty (parent > 0 replaces, never parent+child). GR STO Open/Close on FOB/LCO follows children when parent GR STO is blank (any Open / all Close).`,
  contractPerfTradeCycle: `Completion Date vs Due Date Delivery End. SEA: ATA Discharge Complete; if ATA is empty use ETA at LP, or today when that ETA is before today; no ETA → "-". LAND: OS ≈ 0 MT → Last Receive/WB; else planning/ETA (Open without milestones uses today vs due).`,
  contractPerfDpCycle: `Completion Date vs DP Date. LAND: OS ≈ 0 MT → Last Receive/WB; else planning/ETA.`,
  contractPerfCashCycle: `Completion Date vs Payoff Date. LAND: OS ≈ 0 MT → Last Receive/WB; else planning/ETA.`,
  contractPerfLogCycle: `Cargo Readiness Date − Completion Date. LAND: OS ≈ 0 MT → Last Receive/WB; else planning/ETA.`,

  outstandingQty: `Remaining quantity yet to be delivered. Green = Over Delivered (+MT); black = Still Outstanding.`,

  deliveryQty: `FRC: GR PO Open + WB Netto PKS > 0 → Netto PKS; LCO: GR STO Open + WB Netto PKS > 0 → Netto PKS (same as Trucking Delivery Qty). Empty/null WB delivery stays on SAP. SEA Open with KLIP actuals: shipment delivered qty. GR Close (FRC GR PO / LCO GR STO) uses SAP. FOB/CIF MIX uses Quantity Delivery Vessel when present (not trucking+vessel). Otherwise SAP quantity_delivery (trucking or vessel by incoterm / transport). B2B origin (empty Contract Reff PO): parent NULL or 0 uses SUM of child Delivery Qty capped at origin Contract Qty; parent > 0 replaces (not parent+child).`,

  receivedQty: `FRC: GR PO Open + WB Netto EUP > 0 → Netto EUP; LCO: GR STO Open + WB Netto EUP > 0 → Netto EUP (same as Trucking Received Qty). Empty/null WB receive stays on SAP Quantity Receive. SEA Open with KLIP receive: actual vessel receive. GR Close uses SAP Quantity Receive. Otherwise SAP Quantity Receive. B2B origin (empty Contract Reff PO): parent NULL or 0 uses SUM of child Receive Qty capped at origin Contract Qty; parent > 0 replaces (not parent+child).`,

  outstandingQtyMt: `Contract Qty minus fulfilled quantity by incoterm: CIF/CFR/FRC uses Quantity Receive; FOB/LCO uses Quantity Delivery (same UAT trucking/vessel matrix as the Quantity Delivery column). Over-delivery shows +MT (green); remaining outstanding shows MT (black). B2B origin uses the same qty_move overlay as Delivery/Receive (SUM children capped at origin Contract Qty when parent is NULL or 0).`,
  shipmentOutstandingQtyMt: `Remaining qty on this STO, same as Contracts OS Qty. CIF/CFR/FRC uses Receive; FOB/LCO uses Delivery (Open→KLIP / Close→SAP). When one PO has several STOs, each row repeats the PO remainder (Contract Qty minus all related STOs) for display only. Status cards and Section OS Qty still count that PO once. Missing Delivery/Receive counts as 0 MT. Green = Over Delivered (+MT); black = Still Outstanding.`,
  shipmentEtcNoAtcDueWithin7d: `Shipments without ATC, with Due Date Delivery End on or before today + 7 days (including overdue). Excludes Completed and Cancelled.`,
  shipmentSfalQtyMt: `Ship Figure After Loading (SFAL) from shipment data, displayed in MT (stored as kg in the database).`,
  shipmentSfbdQtyMt: `Ship Figure Before Discharge (SFBD) from shipment data, displayed in MT (stored as kg in the database).`,

  companyName: `From Buyer in latest SAP data. For B2B origin (empty Contract Reff PO), Buyer / Company Name overlay the latest child PO (same as Region/Plant and Truck Unload).`,
  b2bBuyer: `SAP Buyer on this PO. For B2B origin (empty Contract Reff PO), Buyer overlays the latest child PO — not Truck Discharge Location.`,

  b2bParties: `Lists child POs whose Contract Reff PO matches this origin PO, with Buyer, Supplier, Delivery Qty, and Receive Qty.`,

  stoListEta: `Trucking: first date on Daily Planning (Start Daily Plan). Shipment: ETA Vessel Arrival at Loading Port (ETA at LP).`,
  stoListEtc: `Trucking: last date on Daily Planning (End Daily Plan). Shipment: ETA Vessel Complete Discharge (ETC at DP).`,
  stoListAta: `Trucking: first Weighbridge (WB) date while the operation is open; SAP Trucking Start Receive Date when Completed. Shipment: ATA Vessel Arrival at Loading Port (ATA at LP).`,
  stoListAtc: `Trucking: last Weighbridge (WB) date while the operation is open; SAP Trucking Last Receive Date when Completed. Shipment: ATA Vessel Complete Discharge (ATC at DP).`,

  grStoStatus: `SAP GR STO Status across STOs on this PO: Open if any related STO is Open; Close only if every STO is Close (not latest SAP row only). For B2B origin (empty Contract Reff PO), blank parent GR STO uses children the same way. A filled parent GR STO replaces children (not merged). FRC/CIF import status still uses GR PO on the parent.`,

  aiInsight: `Generated by Gemini using aggregated metrics for the filters you selected. Cached per filter combination; use Re-generate to refresh.`,

  dashboardKpiContracts: `Counts and closure mix use contracts in scope of your current dashboard filters (date, plant, supplier, product, group).`,
  dashboardKpiQuantity: `Quantity KPIs use contract ordered vs SAP delivered quantities; outstanding payment uses contracts with at least one blank payoff date, aligned with Quantity Performance logic.`,

  dashboardKpiShipments: `Shipment counts and late rate are based on shipments matching the same dashboard filters.`,

  dashboardKpiTrucking: `Trucking operation counts and completion/late metrics use trucking data in filter scope.`,

  dashboardKpiFinance: `Payment totals and overdue amounts aggregate payments linked to contracts in filter scope.`,

  // Trucking
  lateIndicator: `On Time / Late compares Due Date Delivery End vs ATA/ETA Trucking Last Receive Date (actual first, then ETA; same calendar day = On Time). Shows "-" if Due Date Delivery End is missing.`,
  gainLossPct: `Calculated as (Delivered - Sent) / Sent × 100%. Positive means gain, negative means loss.`,
  gainLossAmount: `Calculated as Delivered - Sent (in Kg). Positive means gain, negative means loss.`,
  truckingOaBudget: `OA Budget is the planned operational allowance (budget) for the trucking leg.`,
  truckingOaActual: `OA Actual is the realized operational allowance (actual cost) for the trucking leg.`,
  etaVsDueDelivery: `ETA fields are planned dates; Due Date Delivery Start/End come from the contract delivery window. Use these to assess schedule risk and lateness.`,
  truckingStatusUnplanned: `Unplanned view table rows: open contracts without a trucking operation, plus unplanned trucking operations (no Daily Planning and not yet started/completed). The badge count matches the table row total, including on ALL (plant filter uses contract origin plant, same as this card). Qty on this card is Outstanding Qty (floored at 0), same formula as Planned.`,
  truckingStatusPlanned: `Open contract with ETA or Daily Planning, plus In Progress (Start Receive). The summary card is labeled Planned / In Progress; the view-table status badge stays Planned. Totals and list filter still include both Planned and In Progress. Qty on this card is Outstanding Qty (after WB).`,
  truckingStatusInProgress: `Included in the Planned card. Trucking shipment (STO/Operation) with a valid Trucking Start Receive Date (SAP AV). Stays In Progress until GR PO/STO is Close, or until Outstanding Qty is within tolerance while GR is still Open.`,
  truckingStatusCompleted: `Trucking shipment (STO/Operation) is Complete when GR PO Status (FRC/CIF) or GR STO Status (LCO/FOB) is Close — no OS Qty check required. Alternatively, when GR is still Open, Complete applies if Outstanding Qty is within tolerance (kg, after WB actual qty when uploaded). Trucking Last Receive Date is informational only.`,
  truckingStatusCancelled: `Operation was set to Cancelled manually and is excluded from active execution. Use the Status filter below to view cancelled operations only.`,
  truckingOutstandingQtyMt: `Outstanding Qty by incoterm for the PO: FRC = Contract Qty − Σ Received Qty across all STOs on the PO; LCO = Contract Qty − Σ Delivered Qty across all STOs on the PO. Displayed in MT. Green = over delivered (+MT); black = still outstanding. Other incoterms show —. B2B origin (empty Contract Reff PO): Delivery/Receive SAP uses SUM of children capped at origin Contract Qty when parent is NULL or 0 (parent > 0 replaces, not parent+child).`,

  truckingDeliveryQty: `GR Open + WB Netto PKS > 0 → Netto PKS; GR Close uses SAP Quantity Delivery Trucking. B2B origin (empty Contract Reff PO): parent NULL or 0 uses SUM of child Delivery Qty capped at origin Contract Qty; parent > 0 replaces (not parent+child).`,

  truckingReceivedQty: `GR Open + WB Netto EUP > 0 → Netto EUP; GR Close uses SAP Quantity Receive. B2B origin (empty Contract Reff PO): parent NULL or 0 uses SUM of child Receive Qty capped at origin Contract Qty; parent > 0 replaces (not parent+child).`,

  // Oil Loss
  oilLossAmount: `Formula: Qty Receive − Qty Delivery (displayed in MT). Qty Delivery follows SAP UAT incoterm rules (Trucking for FRC/LCO; Vessel for FOB/CIF; MIX uses vessel if present, else trucking). Negative values indicate oil loss.`,
  oilLossPct: `Formula: (Qty Receive − Qty Delivery) ÷ Qty Delivery × 100%. Qty Delivery uses SAP UAT Quantity Delivery Trucking/Vessel matrix. Negative values indicate oil loss.`,

  // Shipping Performance
  shipmentTotalDelta: `Sum of all delay gaps in days: (Loading ETA−ETR) + (Loading ETA−ETB) + (Loading ETB−ETC) + (Discharge ETA−ETB) + (Discharge ETB−ETC). Positive = late, negative = ahead of schedule.`,

  shipmentStoQty: `STO Quantity from the linked contract in SAP (in MT). Represents the planned quantity allocated to this shipment.`,
  shipmentReceivedQty: `Shipments View Table grain is the STO (one row). Open + KLIP: sum of Received Qty (Klip) per PO on this STO — same as Edit Shipment Grand Total, not a single PO cell. One PO with several STOs: this row is that STO only (not the full PO copied onto every sibling). GR Close uses SAP Quantity Receive for this STO.`,
  shipmentViewTableDeliveryQty: `Shipments View Table grain is the STO (one row). Open + KLIP: sum of Delivered Qty (Klip) per PO on this STO — same as Edit Shipment Grand Total. One PO with several STOs: this row is that STO only. GR Close uses SAP delivery for this STO. B2B origin (empty Contract Reff PO): child sea STOs are shown on the origin row; the child PO is not a separate row.`,
  shipmentOutstandingQtyActual: `Remaining qty, same as Shipments View Table OS Qty. CIF/CFR/FRC uses Receive; FOB/LCO uses Delivery (Open→KLIP / Close→SAP). When one PO has several STOs, each row repeats the PO remainder for display only. On Going / Close cards, the product tree, and By Vessel totals split that remainder so it is not multiplied by STO count. Green = Over Delivered (+MT); black = Still Outstanding.`,
  shipmentOutstandingQtyPlanning: `Contract Qty minus SAP STO Qty (planning via SAP) minus Shipment Planning Qty (KLIP daily deliverables on shipment + linked trucking for the STO). Net aggregate at STO level — over-planning on one PO can offset another. Displayed in MT.`,
  shipmentPlanningQty: `KLIP shipment planning qty — sum of daily deliverables on the shipment calendar plus linked trucking daily deliverables for the same STO.`,
  /** @deprecated Use shipmentOutstandingQtyActual */
  shipmentOutstandingQty: `SAP STO Qty minus Qty Receive/Delivered (per incoterm) for this shipment/STO. Same for Open and Close; Close = status COMPLETED.`,

  // Shipments
  shipmentLateIndicator: `On Time / Late compares Due Date Delivery End vs ATA/ETA Vessel Complete Discharge (actual first, then ETA; same calendar day = On Time). Shows "-" if Due Date Delivery End is missing.`,
  shipmentSlaDays: `SLA Days is the target duration for the shipment/leg. Used to flag delayed shipments when actual duration exceeds SLA.`,
  vesselOaBudget: `Vessel OA Budget is the planned operational allowance (budget) for the vessel/shipment leg.`,
  vesselOaActual: `Vessel OA Actual is the realized operational allowance (actual cost) for the vessel/shipment leg.`,
  shipmentTcShortageMt: `R4 oil loss (MT): (Qty Receive − Qty Delivery) ÷ 1,000. Quantities are summed across all PO lines on this shipment (KLIP qty preferred, else SAP). Negative = loss; positive = gain. Shows — when delivery ≤ 0 or receive is missing.`,

  /** Shipments page — ETA Loading / Discharge status cards (grouped by STO). */
  shipmentEtaLoadingScope: `Counts grouped STOs in loading phase only (Planned, In Progress, Loading). Completed and Cancelled are excluded. One count per STO group.`,
  shipmentEtaDischargeScope: `Counts grouped STOs in discharge phase only (In Transit, Arrived, Unloading). Completed and Cancelled are excluded. One count per STO group.`,
  shipmentEtaDayDiff: `Day diff = ETA calendar date − today (midnight to midnight). When several ETA milestones exist, bucket priority is: Delay → D → D-2 → >7D (gaps of 3–7 days are not shown on any card).`,

  shipmentEtaLoadingMoreThan7D: `ETA Loading > 7D — no Delay/D/D-2 milestone; at least one loading ETA has day diff > 7.

Loading ETAs: Arrival at Loading Port, Berthed at Loading Port, Start Loading, Completed Loading, Sailed from Loading Port.`,
  shipmentEtaLoadingDMinus2: `ETA Loading D-2 — no Delay or D milestone; at least one loading ETA has day diff of 1 or 2 (tomorrow or the day after).

Loading ETAs: Arrival at Loading Port, Berthed at Loading Port, Start Loading, Completed Loading, Sailed from Loading Port.`,
  shipmentEtaLoadingD: `ETA Loading D — no Delay milestone; at least one loading ETA is today (day diff = 0).

Loading ETAs: Arrival at Loading Port, Berthed at Loading Port, Start Loading, Completed Loading, Sailed from Loading Port.`,
  shipmentEtaLoadingDelay: `ETA Loading Delay — at least one loading ETA date is before today (day diff < 0).

Loading ETAs: Arrival at Loading Port, Berthed at Loading Port, Start Loading, Completed Loading, Sailed from Loading Port.`,
  shipmentEtaLoadingNoEta: `No ETA (Loading) — all loading ETA milestones are empty for this STO group.

Loading ETAs checked: Arrival at Loading Port, Berthed at Loading Port, Start Loading, Completed Loading, Sailed from Loading Port.`,

  shipmentEtaDischargeMoreThan7D: `ETA Discharge > 7D — no Delay/D/D-2 milestone; at least one discharge ETA has day diff > 7.

Discharge ETAs: Arrival at Discharge Port, Berthed at Discharge Port, Start Discharging, Complete Discharge.`,
  shipmentEtaDischargeDMinus2: `ETA Discharge D-2 — no Delay or D milestone; at least one discharge ETA has day diff of 1 or 2 (tomorrow or the day after).

Discharge ETAs: Arrival at Discharge Port, Berthed at Discharge Port, Start Discharging, Complete Discharge.`,
  shipmentEtaDischargeD: `ETA Discharge D — no Delay milestone; at least one discharge ETA is today (day diff = 0).

Discharge ETAs: Arrival at Discharge Port, Berthed at Discharge Port, Start Discharging, Complete Discharge.`,
  shipmentEtaDischargeDelay: `ETA Discharge Delay — at least one discharge ETA date is before today (day diff < 0).

Discharge ETAs: Arrival at Discharge Port, Berthed at Discharge Port, Start Discharging, Complete Discharge.`,
  shipmentEtaDischargeNoEta: `No ETA (Discharge) — all discharge ETA milestones are empty for this STO group.

Discharge ETAs checked: Arrival at Discharge Port, Berthed at Discharge Port, Start Discharging, Complete Discharge.`,

  // Finance
  financeTotalAmount: `Total Amount is the sum of payment_amount across the current finance dataset (subject to any page filters).`,
  financePendingAmount: `Pending Amount includes payments that are not marked paid yet (awaiting confirmation).`,
  financePaidAmount: `Paid Amount includes payments with status PAID.`,
  financeOverdueAmount: `Overdue Amount includes payments past Payment Due Date that are not fully paid.`,
  dueDatePayment: `Payment Due Date is the contractual/latest due date used to determine overdue status.`,
  dpDate: `DP Date is the down payment date (if applicable).`,
  payoffDate: `Payoff Date is the final payoff date; blank payoff date is commonly used to indicate outstanding payment in dashboard logic.`,
  dpDeviationDays: `DP deviation (days) = DP Date - Due Date Payment (in days). Positive means DP happened after due date.`,
  payoffDeviationDays: `Payoff deviation (days) = Payoff Date - Due Date Payment (in days). Positive means payoff happened after due date.`,
} as const

export type FieldHelpKey = keyof typeof FIELD_HELP

/** Row-level tooltip for Outstanding Qty (MT) on the Trucking page. */
export function truckingOutstandingQtyFormulaTooltip(incoterm?: string | null): string {
  const ic = String(incoterm ?? '').trim().toUpperCase()
  if (ic === 'FRC') {
    return 'Formula: Contract Qty − Σ Received Qty across all STOs on the PO (displayed in MT). Green = over delivered; red = still outstanding.'
  }
  if (ic === 'LCO') {
    return 'Formula: Contract Qty − Σ Delivered Qty across all STOs on the PO (displayed in MT). Green = over delivered; red = still outstanding.'
  }
  return FIELD_HELP.truckingOutstandingQtyMt
}
