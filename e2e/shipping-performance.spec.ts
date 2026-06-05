import { expect, test } from '@playwright/test'
import {
  assertValidAvgMetrics,
  countRenderedDataRows,
  expectDrilldownCardTitle,
  getSummaryCardButton,
  getSummaryCardsRegion,
  gotoShippingPerformance,
  loginAsAdmin,
  parseAllSummaryCards,
  parseDrilldownGlobalTotals,
  parseSection3PaginatedRowCount,
  parseSection3ShipmentTotal,
  parseSummaryCardMetrics,
  waitForShippingPerformanceRefresh,
  type ShippingPerfCardKey,
} from './helpers/shipping-performance'

test.describe('Shipping Performance — cross-section data consistency', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await gotoShippingPerformance(page)
  })

  test('Scenario 1: initial load (default All) keeps Sections 1, 2, and 3 in sync', async ({ page }) => {
    const cards = await parseAllSummaryCards(page)
    const sumVessels =
      cards.ongoingNoEta.vessels + cards.ongoingWithEta.vessels + cards.close.vessels
    const sumContracts =
      cards.ongoingNoEta.contracts + cards.ongoingWithEta.contracts + cards.close.contracts

    const drilldownTotals = await parseDrilldownGlobalTotals(page)
    const section3Total = await parseSection3ShipmentTotal(page)
    const paginatedRows = await parseSection3PaginatedRowCount(page)
    const renderedRows = await countRenderedDataRows(page)

    // Section 1 partitions are mutually exclusive at contract level → summed contracts match global scope.
    expect(sumContracts).toBe(drilldownTotals.contracts)

    // Section 3 "All" scope lists every shipment row in the active global filter.
    expect(section3Total).toBeGreaterThanOrEqual(0)
    if (drilldownTotals.contracts > 0) {
      expect(section3Total).toBeGreaterThan(0)
    } else {
      expect(section3Total).toBe(0)
    }

    // Vessel totals may overlap across lifecycle cards; global unique count is never greater than the sum.
    expect(drilldownTotals.vessels).toBeLessThanOrEqual(sumVessels)

    // Section 2 reflects default "All" card filter.
    await expectDrilldownCardTitle(page, 'All', 'eta')
    await expect(page.getByText('Pick one', { exact: true })).toBeVisible()
    await expect(page.getByText('Pick product first', { exact: true })).toBeVisible()
    await expect(page.getByText('Pick group plant first', { exact: true })).toBeVisible()
    await expect(page.getByText('Pick incoterm first', { exact: true })).toBeVisible()

    // Section 3 pagination row count matches rendered <tr> rows on the current page.
    const pageSize = 20
    const expectedRendered = Math.min(pageSize, section3Total)
    expect(paginatedRows).toBe(expectedRendered)
    expect(renderedRows).toBe(expectedRendered)

    // Scenario 3 (initial): average metrics on every Section 1 card are well-formed.
    for (const card of Object.values(cards)) {
      if (card.avgMetrics.length > 0) {
        assertValidAvgMetrics(card.avgMetrics)
      }
    }
  })

  test('Scenario 2: clicking a summary card syncs Section 2 drilldown and Section 3 totals', async ({
    page,
  }) => {
    const targetCard: ShippingPerfCardKey = 'close'
    const cardTitle = 'Close'

    const before = await parseSummaryCardMetrics(page, targetCard)
    expect(Number.isFinite(before.vessels)).toBeTruthy()
    expect(Number.isFinite(before.contracts)).toBeTruthy()

    const clickResponse = page.waitForResponse(
      (res) => res.url().includes('/shipments/performance') && res.status() === 200,
    )
    await getSummaryCardButton(page, targetCard).click()
    await clickResponse.catch(() => undefined)
    await waitForShippingPerformanceRefresh(page)

    // Close card switches drilldown to ATA mode.
    await expectDrilldownCardTitle(page, cardTitle, 'ata')

    const drilldownTotals = await parseDrilldownGlobalTotals(page)
    expect(drilldownTotals.vessels).toBe(before.vessels)
    expect(drilldownTotals.contracts).toBe(before.contracts)

    const section3Total = await parseSection3ShipmentTotal(page)
    const paginatedRows = await parseSection3PaginatedRowCount(page)
    const renderedRows = await countRenderedDataRows(page)

    // Section 3 scope label mirrors the active card filter.
    await expect(
      getSummaryCardsRegion(page)
        .locator('h3')
        .filter({ hasText: /^All Shipments$/ })
        .locator('xpath=../p//span[contains(., "Contract date:")]')
        .filter({ hasText: cardTitle }),
    ).toBeVisible()

    // When the card reports zero contracts, the table must also be empty.
    if (before.contracts === 0) {
      expect(section3Total).toBe(0)
      expect(paginatedRows).toBe(0)
      expect(renderedRows).toBe(0)
      await expect(page.getByText('No data found')).toBeVisible()
    } else {
      expect(section3Total).toBeGreaterThan(0)
      const pageSize = 20
      const expectedRendered = Math.min(pageSize, section3Total)
      expect(paginatedRows).toBe(expectedRendered)
      expect(renderedRows).toBe(expectedRendered)
    }
  })

  test('Scenario 2b: On Going (with ETA) card enforces zero-count consistency', async ({ page }) => {
    const targetCard: ShippingPerfCardKey = 'ongoingWithEta'
    const metrics = await parseSummaryCardMetrics(page, targetCard)

    await getSummaryCardButton(page, targetCard).click()
    await waitForShippingPerformanceRefresh(page)

    await expectDrilldownCardTitle(page, 'On Going (with ETA)', 'eta')

    const section3Total = await parseSection3ShipmentTotal(page)
    if (metrics.contracts === 0 && metrics.vessels === 0) {
      await expect(page.getByText(/No shipments found for the current filters/i)).toBeVisible()
      expect(section3Total).toBe(0)
      expect(await countRenderedDataRows(page)).toBe(0)
    } else {
      const drilldownTotals = await parseDrilldownGlobalTotals(page)
      expect(drilldownTotals.vessels).toBe(metrics.vessels)
      expect(drilldownTotals.contracts).toBe(metrics.contracts)
      expect(section3Total).toBeGreaterThan(0)
    }
  })

  test('Scenario 3: average metrics render valid formatted values', async ({ page }) => {
    const cards = await parseAllSummaryCards(page)

    for (const [cardKey, card] of Object.entries(cards) as [ShippingPerfCardKey, typeof cards.close][]) {
      if (cardKey === 'ongoingNoEta') continue
      expect(card.avgMetrics.length).toBeGreaterThanOrEqual(6)
      assertValidAvgMetrics(card.avgMetrics)
    }

    // Close card uses ATA labels in Section 3 headers when active.
    await getSummaryCardButton(page, 'close').click()
    await waitForShippingPerformanceRefresh(page)
    await expect(page.getByRole('columnheader', { name: /ATA/i }).first()).toBeVisible()
  })
})
