import { expect, type Locator, type Page } from '@playwright/test'

export type ShippingPerfCardKey = 'ongoingNoEta' | 'ongoingWithEta' | 'close'

export interface SummaryCardMetrics {
  vessels: number
  contracts: number
  avgMetrics: string[]
  button: Locator
}

/** Accessible names are flattened, e.g. "Close Total Vessels 58 Contracts 116 …". */
const CARD_ACCESSIBLE_NAME: Record<ShippingPerfCardKey, RegExp> = {
  ongoingNoEta: /On Going.*no ETA.*Total Vessels/i,
  ongoingWithEta: /On Going.*with ETA.*Total Vessels/i,
  close: /^Close.*Total Vessels/i,
}

/** Parse integers like "1,234" from summary card copy. */
export function parseLocaleInt(raw: string | null | undefined): number {
  if (!raw) return NaN
  const cleaned = raw.replace(/,/g, '').trim()
  const value = Number.parseInt(cleaned, 10)
  return Number.isFinite(value) ? value : NaN
}

export function getSummaryCardsRegion(page: Page): Locator {
  return page.getByRole('main')
}

export function getSummaryCardButton(page: Page, card: ShippingPerfCardKey): Locator {
  return getSummaryCardsRegion(page).getByRole('button', { name: CARD_ACCESSIBLE_NAME[card] })
}

export async function parseSummaryCardMetrics(
  page: Page,
  card: ShippingPerfCardKey,
): Promise<SummaryCardMetrics> {
  const button = getSummaryCardButton(page, card)
  await expect(button).toBeVisible()
  const text = await button.innerText()

  const vessels = parseLocaleInt(text.match(/Total Vessels\s*([\d,]+)/i)?.[1])
  const contracts = parseLocaleInt(text.match(/Contracts\s*([\d,]+)/i)?.[1])

  const avgMetrics = [
    ...text.matchAll(/Avg\s+(?:Load\s+\([^)]+\)|Discharge\s+\([^)]+\)|Total)\s+(?:-\s*days?|\d+\s+days?)/gi),
  ].map((m) => m[0].trim())

  return { vessels, contracts, avgMetrics, button }
}

export async function parseAllSummaryCards(page: Page): Promise<Record<ShippingPerfCardKey, SummaryCardMetrics>> {
  const keys: ShippingPerfCardKey[] = ['ongoingNoEta', 'ongoingWithEta', 'close']
  const entries = await Promise.all(
    keys.map(async (key) => [key, await parseSummaryCardMetrics(page, key)] as const),
  )
  return Object.fromEntries(entries) as Record<ShippingPerfCardKey, SummaryCardMetrics>
}

export async function parseDrilldownGlobalTotals(page: Page): Promise<{ contracts: number; vessels: number }> {
  const line = getSummaryCardsRegion(page).getByText(/unique contracts.*unique vessels \(global\)/i).first()
  await expect(line).toBeVisible()
  const text = (await line.textContent()) ?? ''
  const contracts = parseLocaleInt(text.match(/([\d,]+)\s+unique contracts/i)?.[1])
  const vessels = parseLocaleInt(text.match(/([\d,]+)\s+unique vessels/i)?.[1])
  return { contracts, vessels }
}

export async function parseSection3ShipmentTotal(page: Page): Promise<number> {
  const subtitle = getSummaryCardsRegion(page)
    .locator('h3')
    .filter({ hasText: /^(All Shipments|By Vessel)$/ })
    .locator('xpath=../p[contains(., "shipments") or contains(., "vessels")]')
    .first()

  await expect(subtitle).toBeVisible()
  const text = (await subtitle.textContent()) ?? ''
  const shipments = parseLocaleInt(text.match(/^([\d,]+)\s+shipments/i)?.[1])
  if (Number.isFinite(shipments)) return shipments

  const vessels = parseLocaleInt(text.match(/^([\d,]+)\s+vessels?/i)?.[1])
  return Number.isFinite(vessels) ? vessels : NaN
}

export async function parseSection3PaginatedRowCount(page: Page): Promise<number> {
  const subtitle = getSummaryCardsRegion(page)
    .locator('h3')
    .filter({ hasText: /^(All Shipments|By Vessel)$/ })
    .locator('xpath=../p[contains(., "rows")]')
    .first()
  const text = (await subtitle.textContent()) ?? ''
  return parseLocaleInt(text.match(/·\s*([\d,]+)\s+rows/i)?.[1])
}

export async function countRenderedDataRows(page: Page): Promise<number> {
  const tbody = getSummaryCardsRegion(page).locator('table tbody').last()
  await expect(tbody).toBeVisible()
  const rows = tbody.locator('tr:not([aria-hidden])')
  const noData = tbody.getByText('No data found')
  if (await noData.isVisible().catch(() => false)) return 0
  return rows.count()
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Username' }).fill(process.env.E2E_USERNAME ?? 'admin')
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.E2E_PASSWORD ?? 'admin123')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/dashboard/)
}

export async function gotoShippingPerformance(page: Page): Promise<void> {
  const perfResponse = page.waitForResponse(
    (res) => res.url().includes('/shipments/performance') && res.status() === 200,
    { timeout: 90_000 },
  )
  await page.goto('/shipping-performance')
  await perfResponse
  await waitForShippingPerformanceReady(page)
}

export async function waitForShippingPerformanceReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Shipping Performance', level: 1 })).toBeVisible()
  await expect(
    getSummaryCardsRegion(page).getByRole('button', { name: /Total Vessels/i }).first(),
  ).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.locator('[aria-label="Loading contract table"]')).toHaveCount(0, { timeout: 60_000 })
  await expect(page.getByText(/Loading shipments/i)).toHaveCount(0, { timeout: 60_000 })
}

export async function waitForShippingPerformanceRefresh(page: Page): Promise<void> {
  const skeleton = page.locator('[aria-label="Loading contract table"]')
  if (await skeleton.count()) {
    await expect(skeleton).toHaveCount(0, { timeout: 60_000 })
  }
  await waitForShippingPerformanceReady(page)
}

export function assertValidAvgMetrics(avgMetrics: string[]): void {
  expect(avgMetrics.length).toBeGreaterThan(0)
  for (const metric of avgMetrics) {
    expect(metric).not.toMatch(/NaN|undefined|null/i)
    expect(metric).toMatch(
      /Avg\s+(?:Load\s+\([^)]+\)|Discharge\s+\([^)]+\)|Total)\s+(?:-\s*days?|\d+\s+days?)$/i,
    )
  }
}

export async function expectDrilldownCardTitle(
  page: Page,
  cardTitle: string,
  mode: 'eta' | 'ata' = 'eta',
): Promise<void> {
  const label = mode === 'ata' ? 'Performance Drilldown (ATA)' : 'Performance Drilldown (ETA)'
  const heading = getSummaryCardsRegion(page)
    .getByRole('heading', { level: 3 })
    .filter({ hasText: label })
    .filter({ hasText: cardTitle })
  await expect(heading.first()).toBeVisible()
}
